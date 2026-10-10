import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  type Customer,
  type Invoice,
  type InvoiceItem,
  type Vehicle,
} from '@prisma/client';
import { lockFinanceSettingsAndAssertOpen } from '../finance/fiscal-lock.helpers.js';
import {
  lockLegalEntityAndAssertActive,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  buildInvoiceSnapshotV2,
  type InvoiceSnapshotV2,
  type InvoiceSnapshotV2Margin,
} from './invoice-snapshot-v2.js';
import {
  lockInvoiceSource,
  resolveInvoiceOwnershipFromSource,
} from './invoice-ownership.resolver.js';
import {
  assertBrandingWriterEnabled,
  assertCommitmentContextMatches,
  assertAtHighValueBusinessRecipientUid,
  assertCustomerComplete,
  assertOwnershipUnchanged,
  assertSourceOwnershipMatchesIdentity,
  assertSupportedTaxProfile,
  computeInvoiceDates,
  loadAccountingProfile,
  loadAndValidateSeller,
  resolveBrandingSnapshot,
  resolveInvoiceLineAllocations,
  type InvoiceCommitmentContext,
  type InvoiceSourceIdentity,
} from './invoice-snapshot-v2.helpers.js';

export type { InvoiceCommitmentContext, InvoiceSourceIdentity };

export type InvoiceWithRelations = Invoice & {
  items: InvoiceItem[];
  customer: Customer;
  vehicle: Vehicle | null;
};

export type CommitInvoiceSnapshotInput = {
  tx: Prisma.TransactionClient;
  tenantId: string;
  invoice: InvoiceWithRelations;
  invoiceNumber: string;
  margin?: InvoiceSnapshotV2Margin;
  lockInvoiceRow?: boolean;
  commitmentContext?: InvoiceCommitmentContext;
};

export type PreparedInvoiceSnapshot = {
  snapshot: InvoiceSnapshotV2;
  ownership: InvoiceCommitmentContext['ownership'];
  dueDate: Date;
  supplyFrom: Date;
  supplyTo: Date;
  logoAssetId: string | null;
};

@Injectable()
export class InvoiceSnapshotCommitService {
  constructor(private readonly siteContext: SiteContextService) {}

  async lockCommitmentContext(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourceIdentity: InvoiceSourceIdentity,
    date: Date,
  ): Promise<InvoiceCommitmentContext> {
    assertBrandingWriterEnabled();

    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const sourceOwnership = await resolveInvoiceOwnershipFromSource(
      tx,
      tenantId,
      authorizedSiteIds,
      sourceIdentity,
    );
    assertSourceOwnershipMatchesIdentity(sourceIdentity, sourceOwnership);

    await lockLegalEntityAndAssertActive(
      tx,
      tenantId,
      sourceOwnership.legalEntityId,
    );
    await lockSitesAndAssertActive(tx, tenantId, [sourceOwnership.siteId]);
    await lockFinanceSettingsAndAssertOpen(tx, tenantId, date);
    await lockInvoiceSource(tx, tenantId, authorizedSiteIds, sourceIdentity);

    const ownership = await resolveInvoiceOwnershipFromSource(
      tx,
      tenantId,
      authorizedSiteIds,
      sourceIdentity,
    );
    assertOwnershipUnchanged(sourceOwnership, ownership);

    return {
      tenantId,
      sourceIdentity,
      authorizedSiteIds: [...authorizedSiteIds],
      ownership,
    };
  }

  async lockInvoiceRow(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
  ): Promise<void> {
    // eslint-disable-next-line no-restricted-syntax -- tenant-scoped invoice lock follows the ordered source lock.
    const invoiceRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM invoices
      WHERE id = ${invoiceId}
        AND tenant_id = ${tenantId}
      FOR UPDATE
    `;
    if (invoiceRows.length !== 1) {
      throw new NotFoundException('Invoice not found');
    }
  }

  async prepareV2Snapshot(
    input: Omit<CommitInvoiceSnapshotInput, 'invoiceNumber'> & {
      invoiceNumber?: string;
    },
  ): Promise<PreparedInvoiceSnapshot> {
    const { tx, tenantId, invoice, margin } = input;
    const invoiceNumber = input.invoiceNumber ?? invoice.invoice_number ?? '';
    assertSupportedTaxProfile(invoice.tax_mode);
    const commitmentContext =
      input.commitmentContext ??
      (await this.lockCommitmentContext(tx, tenantId, invoice, invoice.date));
    assertCommitmentContextMatches(tenantId, invoice, commitmentContext);
    const { ownership } = commitmentContext;

    if (input.lockInvoiceRow !== false) {
      await this.lockInvoiceRow(tx, tenantId, invoice.id);
    }

    const seller = await loadAndValidateSeller(
      tx,
      tenantId,
      ownership.legalEntityId,
    );
    assertCustomerComplete(invoice.customer);
    // In-kind credits (a vehicle trade-in) lower the amount billed but belong to the sale's consideration,
    // so the high-value recipient UID threshold applies to the amount before those credits.
    const inKindCredits = invoice.items.reduce((sum, item) => {
      const total = item.line_total ?? new Prisma.Decimal(0);
      return total.isNegative() ? sum.add(total.abs()) : sum;
    }, new Prisma.Decimal(0));
    assertAtHighValueBusinessRecipientUid({
      seller,
      customer: invoice.customer,
      totalGross: invoice.total_gross.add(inKindCredits),
    });
    const profile = await loadAccountingProfile(
      tx,
      tenantId,
      ownership.legalEntityId,
    );
    const lineAllocations = await resolveInvoiceLineAllocations(
      tx,
      tenantId,
      invoice,
      seller,
      profile,
    );

    const { supplyFrom, supplyTo, dueDate } = computeInvoiceDates(
      invoice,
      seller.payment_terms_days ?? 0,
    );

    const committedAt = new Date();
    const branding = await resolveBrandingSnapshot(
      tx,
      tenantId,
      ownership.legalEntityId,
      committedAt,
    );
    const snapshot = buildInvoiceSnapshotV2({
      invoice: {
        ...invoice,
        invoice_number: invoiceNumber,
        due_date: dueDate,
        supply_date_from: supplyFrom,
        supply_date_to: supplyTo,
      },
      seller,
      siteId: ownership.siteId,
      legalEntityId: ownership.legalEntityId,
      lineAllocations,
      margin,
      branding,
      committedAt,
    });

    return {
      snapshot,
      ownership,
      dueDate,
      supplyFrom,
      supplyTo,
      logoAssetId: branding.logo?.asset_id ?? null,
    };
  }

  async persistV2Snapshot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
    prepared: PreparedInvoiceSnapshot,
  ): Promise<void> {
    await tx.invoice.updateMany({
      where: { id: invoiceId, tenant_id: tenantId },
      data: {
        site_id: prepared.ownership.siteId,
        legal_entity_id: prepared.ownership.legalEntityId,
        currency: 'EUR',
        supply_date_from: prepared.supplyFrom,
        supply_date_to: prepared.supplyTo,
        due_date: prepared.dueDate,
        snapshot: prepared.snapshot,
      },
    });

    await Promise.all(
      prepared.snapshot.items.map((item) =>
        tx.invoiceItem.updateMany({
          where: { id: item.id, tenant_id: tenantId, invoice_id: invoiceId },
          data: {
            accounting_snapshot: item.accounting_allocation,
          },
        }),
      ),
    );

    if (prepared.logoAssetId) {
      await tx.invoiceBrandAssetReference.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: prepared.ownership.legalEntityId,
          invoice_id: invoiceId,
          asset_id: prepared.logoAssetId,
        },
      });
    }
  }

  async commitV2Snapshot(
    input: CommitInvoiceSnapshotInput,
  ): Promise<InvoiceSnapshotV2> {
    const prepared = await this.prepareV2Snapshot(input);
    await this.persistV2Snapshot(
      input.tx,
      input.tenantId,
      input.invoice.id,
      prepared,
    );
    return prepared.snapshot;
  }
}

export function assertInvoiceHasSourceDocument(invoice: {
  sales_order_id: string | null;
  workshop_order_id: string | null;
  vehicle_sale_id: string | null;
  status: InvoiceStatus;
}): void {
  if (
    invoice.status !== InvoiceStatus.DRAFT &&
    invoice.status !== InvoiceStatus.ISSUED &&
    invoice.status !== InvoiceStatus.FINALIZED
  ) {
    return;
  }

  if (
    !invoice.sales_order_id &&
    !invoice.workshop_order_id &&
    !invoice.vehicle_sale_id
  ) {
    throw new BadRequestException({
      code: 'SOURCE_DOCUMENT_REQUIRED',
      message:
        'Invoice issuance requires a source document with persisted site ownership.',
    });
  }
}
