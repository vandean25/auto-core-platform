import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopEstimateStatus } from '@prisma/client';
import {
  collectCustomerMissingFields,
  resolveBrandingSnapshot,
} from '../invoices/invoice-snapshot-v2.helpers.js';
import { computeSellerReadiness } from '../site/legal-entity-readiness.js';
import type { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import {
  loadTenantDefaultLocale,
  resolveCustomerDocumentLanguage,
} from '../common/i18n/customer-document-language.js';
import {
  buildWorkshopEstimateLines,
  buildWorkshopEstimateTotals,
  collectEstimateCustomerSendBlockers,
  collectEstimateSourceLines,
} from './workshop-estimate-lines.helpers.js';
import {
  buildWorkshopEstimateSnapshot,
  buildWorkshopEstimateValidityWindow,
  hashWorkshopEstimateSnapshot,
} from './workshop-estimate-snapshot.js';
import { retainUntilAtSend } from './workshop-estimate-retention.helpers.js';
import {
  invalidateSupersededApprovalTokens,
  queueEstimateEmailInTx,
} from './workshop-estimate-email-queue.js';
import { loadAndLockOrderForWrite } from './workshop-estimate-order-access.js';
import type { EstimateScope } from './workshop-estimate-scope.js';
import type { EstimateSendOptions } from './workshop-estimate-send.options.js';

export type CommitSendVersionParams = {
  scope: EstimateScope;
  versionId: string;
  options: EstimateSendOptions;
  approvalBaseUrl: string | null;
  outbox: NotificationOutboxService;
};

export async function commitSendVersionInTx(
  tx: Prisma.TransactionClient,
  params: CommitSendVersionParams,
): Promise<string | null> {
  const { scope, versionId, options, approvalBaseUrl, outbox } = params;
  const version = await tx.workshopEstimateVersion.findFirst({
    where: {
      id: versionId,
      tenant_id: scope.tenantId,
      estimate: { site_id: scope.siteId },
    },
    select: {
      id: true,
      estimate_id: true,
      version: true,
      status: true,
      estimate: {
        select: { estimate_number: true, workshop_order_id: true },
      },
    },
  });
  if (!version) {
    throw new NotFoundException('Workshop estimate version not found');
  }
  if (version.status !== WorkshopEstimateStatus.DRAFT) {
    throw new ConflictException({
      code: 'ESTIMATE_NOT_DRAFT',
      message: 'Only a draft estimate version can be sent.',
    });
  }

  const order = await loadAndLockOrderForWrite(
    tx,
    scope,
    version.estimate.workshop_order_id,
  );
  const sourceLines = collectEstimateSourceLines(order.tasks);
  const sendBlockers = collectEstimateCustomerSendBlockers(sourceLines);
  if (sendBlockers.length > 0) {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_CUSTOMER_SEND_BLOCKED',
      message:
        'The estimate cannot be sent to the customer until zero-price and claimed-fitment lines are resolved.',
      blockers: sendBlockers,
    });
  }
  const lines = buildWorkshopEstimateLines(sourceLines);
  if (lines.length === 0) {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_NO_LINES',
      message: 'The estimate needs at least one labor or parts line.',
    });
  }
  if (!order.customer) {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_CUSTOMER_REQUIRED',
      message: 'The workshop order needs a customer before sending.',
    });
  }
  const missingCustomer = collectCustomerMissingFields(order.customer);
  if (missingCustomer.length > 0) {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_CUSTOMER_INCOMPLETE',
      message: 'Customer details are incomplete for the estimate.',
      missingFields: missingCustomer,
    });
  }

  const site = await tx.site.findFirst({
    where: { id: scope.siteId, tenant_id: scope.tenantId },
    select: { legal_entity: true },
  });
  if (!site) {
    throw new NotFoundException('Workshop order site not found');
  }
  const legalEntity = site.legal_entity;
  const readiness = computeSellerReadiness(legalEntity);
  if (!readiness.isReady) {
    throw new UnprocessableEntityException({
      code: 'SELLER_IDENTITY_INCOMPLETE',
      message: 'Seller identity is incomplete for the estimate.',
      missingFields: readiness.missingFields,
    });
  }

  const issuedAt = new Date();
  const { validFrom, validUntil: defaultValidUntil } =
    buildWorkshopEstimateValidityWindow(issuedAt);
  const validUntil = options.validUntilOverride ?? defaultValidUntil;
  if (validUntil.getTime() <= validFrom.getTime()) {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_VALID_UNTIL_INVALID',
      message: 'The estimate validity end must be after the issue time.',
    });
  }
  const branding = await resolveBrandingSnapshot(
    tx,
    scope.tenantId,
    legalEntity.id,
    issuedAt,
    { lockLogo: true },
  );
  const totals = buildWorkshopEstimateTotals(lines);
  const tenantDefaultLocale = await loadTenantDefaultLocale(tx, scope.tenantId);
  const documentLocale = resolveCustomerDocumentLanguage(
    order.customer,
    tenantDefaultLocale,
  );
  const snapshot = buildWorkshopEstimateSnapshot({
    estimateNumber: version.estimate.estimate_number,
    version: version.version,
    issuedAt,
    validFrom,
    validUntil,
    freeOfCharge: true,
    seller: legalEntity,
    customer: order.customer,
    vehicle: {
      make: order.vehicle.make,
      model: order.vehicle.model,
      year: order.vehicle.year,
      vin: order.vehicle.vin,
      plate: order.vehicle.plate,
    },
    order: {
      order_number: order.order_number,
      odometer: order.odometer,
    },
    lines,
    totals,
    branding,
    documentLocale,
  });

  await tx.workshopEstimateVersion.updateMany({
    where: {
      tenant_id: scope.tenantId,
      estimate_id: version.estimate_id,
      status: WorkshopEstimateStatus.SENT,
      id: { not: versionId },
    },
    data: { status: WorkshopEstimateStatus.SUPERSEDED },
  });
  await invalidateSupersededApprovalTokens(
    tx,
    scope.tenantId,
    version.estimate_id,
    issuedAt,
  );

  const sent = await tx.workshopEstimateVersion.updateMany({
    where: {
      id: versionId,
      tenant_id: scope.tenantId,
      status: WorkshopEstimateStatus.DRAFT,
    },
    data: {
      status: WorkshopEstimateStatus.SENT,
      legal_entity_id: legalEntity.id,
      sent_at: issuedAt,
      valid_from: validFrom,
      valid_until: validUntil,
      total_net: new Prisma.Decimal(totals.total_net),
      total_tax: new Prisma.Decimal(totals.total_tax),
      total_gross: new Prisma.Decimal(totals.total_gross),
      snapshot: snapshot,
      snapshot_sha256: hashWorkshopEstimateSnapshot(snapshot),
      legal_text_version: snapshot.legal.text_version,
      legal_text_sha256: snapshot.legal.text_sha256,
      retain_until: retainUntilAtSend(issuedAt),
    },
  });
  if (sent.count !== 1) {
    throw new ConflictException({
      code: 'ESTIMATE_NOT_DRAFT',
      message: 'Only a draft estimate version can be sent.',
    });
  }

  if (branding.logo) {
    await tx.workshopEstimateBrandAssetReference.create({
      data: {
        tenant_id: scope.tenantId,
        legal_entity_id: legalEntity.id,
        workshop_estimate_version_id: versionId,
        asset_id: branding.logo.asset_id,
      },
    });
  }

  if (approvalBaseUrl === null) {
    return null;
  }
  return queueEstimateEmailInTx(tx, outbox, {
    tenantId: scope.tenantId,
    versionId,
    workshopOrderId: order.id,
    controllerLegalEntityId: legalEntity.id,
    vehicle: order.vehicle,
    customer: order.customer,
    sellerName: legalEntity.name,
    estimateNumber: version.estimate.estimate_number,
    approvalBaseUrl,
    validUntil,
    issuedAt,
  });
}
