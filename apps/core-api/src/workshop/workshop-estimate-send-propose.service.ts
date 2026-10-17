import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopEstimateStatus,
  WorkshopLineItemType,
} from '@prisma/client';
import { maskEmailAddress } from '../audit/audit-redaction.util.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import {
  buildWorkshopEstimateLines,
  buildWorkshopEstimateTotals,
  collectEstimateCustomerSendBlockers,
  collectEstimateSourceLines,
} from './workshop-estimate-lines.helpers.js';
import {
  pinCustomerEstimateRecipientEmail,
  resolveCustomerEstimateRecipientEmail,
} from './workshop-estimate-customer-email.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';
import { assertBackOfficeRole } from './workshop-estimate-scope.js';
import {
  proposeEstimateSendInputSchema,
  type ProposeEstimateSendInput,
} from './workshop-estimate-send-propose.schema.js';

export type EstimateSendProposeLinePreview = {
  description: string;
  quantity: string;
  unit_price: string;
  net: string;
  gross: string;
};

export type EstimateSendProposePreview = {
  workshop_order_id: string;
  site_id: string;
  channel: 'email';
  estimate_number: string;
  estimate_version_id: string;
  recipient_email_masked: string;
  lines: EstimateSendProposeLinePreview[];
  totals: { net: string; vat: string; gross: string };
  valid_until: string | null;
};

export type EstimateSendProposeResult = EstimateSendProposePreview & {
  id: string;
  entityId: string;
  status: WorkshopEstimateStatus;
};

const ORDER_FOR_ESTIMATE_SEND_SELECT = {
  id: true,
  site_id: true,
  customer: {
    select: {
      id: true,
      contact_email_ok: true,
      email: true,
    },
  },
  vehicle: {
    select: { make: true, model: true },
  },
  tasks: {
    orderBy: { sequence: 'asc' },
    select: {
      line_items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          item_no: true,
          description: true,
          quantity: true,
          unit_price: true,
          part_execution_status: true,
          fitment_notes: true,
        },
      },
    },
  },
} satisfies Prisma.WorkshopOrderSelect;

@Injectable()
export class WorkshopEstimateSendProposeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly estimates: WorkshopEstimateService,
  ) {}

  async buildExecutionContext(): Promise<Record<string, unknown>> {
    const siteId = await this.siteContext.getSiteId();
    const tenantId = await this.tenantContext.getTenantId();
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException('Active site not found');
    }
    return { site_id: siteId };
  }

  async enrichInput(input: unknown): Promise<unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return input;
    }
    const record = { ...(input as Record<string, unknown>) };
    const parsed = proposeEstimateSendInputSchema.parse(record);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const plan = await this.planSend(parsed, tenantId, siteId);
    record.pinned_workshop_order_id = parsed.workshop_order_id;
    record.pinned_lines_digest = plan.digest;
    record.pinned_customer_id = plan.customerId;
    record.pinned_recipient_pin = plan.recipientPin;
    record.pinned_needs_create_estimate = plan.needsCreateEstimate;
    record.pinned_needs_revision = plan.needsRevision;
    if (plan.draftVersionId) {
      record.pinned_draft_version_id = plan.draftVersionId;
    }
    if (plan.validUntilIso) {
      record.pinned_valid_until = plan.validUntilIso;
    }
    return record;
  }

  async buildPolicyContext(input: unknown): Promise<{ amount_eur: number }> {
    const parsed = proposeEstimateSendInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const plan = await this.planSend(parsed, tenantId, siteId);
    return { amount_eur: Number(plan.preview.totals.gross) };
  }

  async applySend(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<EstimateSendProposeResult> {
    assertBackOfficeRole(
      this.tenantContext,
      'Sending workshop estimates through MCP',
    );
    const parsed = proposeEstimateSendInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const expectedSiteId =
      typeof executionContext?.site_id === 'string'
        ? executionContext.site_id
        : await this.siteContext.getSiteId();

    const orderId = parsed.pinned_workshop_order_id ?? parsed.workshop_order_id;
    if (orderId !== parsed.workshop_order_id) {
      throw new ConflictException(
        'Workshop order id does not match the pinned proposal order',
      );
    }

    const plan = await this.planSend(parsed, tenantId, expectedSiteId);
    this.assertPinnedState(parsed, plan);

    const versionId = await this.resolveVersionIdForApply(
      parsed,
      orderId,
      tenantId,
      expectedSiteId,
    );

    const existing = await this.prisma.workshopEstimateVersion.findFirst({
      where: {
        id: versionId,
        tenant_id: tenantId,
        estimate: { workshop_order_id: orderId, site_id: expectedSiteId },
      },
      select: {
        id: true,
        status: true,
        estimate: { select: { estimate_number: true } },
        total_gross: true,
        total_net: true,
        total_tax: true,
        valid_until: true,
      },
    });
    if (!existing) {
      throw new ConflictException(
        'The estimate version for this proposal is no longer available',
      );
    }

    if (existing.status === WorkshopEstimateStatus.SENT) {
      return this.mapSentVersion(existing, orderId, expectedSiteId, plan);
    }
    if (existing.status !== WorkshopEstimateStatus.DRAFT) {
      throw new ConflictException(
        'The estimate version changed since this proposal was created',
      );
    }

    const validUntilOverride = parsed.pinned_valid_until
      ? new Date(parsed.pinned_valid_until)
      : undefined;
    const sent = await this.estimates.sendVersion(versionId, {
      notifyCustomerByEmail: true,
      validUntilOverride,
    });

    return {
      id: sent.id,
      entityId: sent.id,
      workshop_order_id: orderId,
      site_id: expectedSiteId,
      channel: 'email',
      estimate_number: sent.estimate_number,
      estimate_version_id: sent.id,
      status: sent.status,
      recipient_email_masked: maskEmailAddress(plan.recipientEmail),
      lines: plan.preview.lines,
      totals: {
        net: sent.total_net ?? plan.preview.totals.net,
        vat: sent.total_tax ?? plan.preview.totals.vat,
        gross: sent.total_gross ?? plan.preview.totals.gross,
      },
      valid_until: sent.valid_until ?? null,
    };
  }

  private mapSentVersion(
    version: {
      id: string;
      status: WorkshopEstimateStatus;
      estimate: { estimate_number: string };
      total_gross: Prisma.Decimal | null;
      total_net: Prisma.Decimal | null;
      total_tax: Prisma.Decimal | null;
      valid_until: Date | null;
    },
    orderId: string,
    siteId: string,
    plan: {
      recipientEmail: string;
      preview: EstimateSendProposePreview;
    },
  ): EstimateSendProposeResult {
    const net = version.total_net?.toFixed(2) ?? plan.preview.totals.net;
    const vat = version.total_tax?.toFixed(2) ?? plan.preview.totals.vat;
    const gross = version.total_gross?.toFixed(2) ?? plan.preview.totals.gross;
    return {
      id: version.id,
      entityId: version.id,
      workshop_order_id: orderId,
      site_id: siteId,
      channel: 'email',
      estimate_number: version.estimate.estimate_number,
      estimate_version_id: version.id,
      status: version.status,
      recipient_email_masked: maskEmailAddress(plan.recipientEmail),
      lines: plan.preview.lines,
      totals: { net, vat, gross },
      valid_until: version.valid_until?.toISOString() ?? null,
    };
  }

  private assertPinnedState(
    parsed: ProposeEstimateSendInput,
    plan: {
      digest: string;
      customerId: string;
      recipientPin: string;
      draftVersionId: string | null;
      needsCreateEstimate: boolean;
      needsRevision: boolean;
      validUntilIso: string | null;
    },
  ): void {
    if (
      !parsed.pinned_lines_digest ||
      !parsed.pinned_customer_id ||
      !parsed.pinned_recipient_pin
    ) {
      throw new ConflictException(
        'Proposal payload is missing required estimate send pins',
      );
    }
    if (parsed.pinned_lines_digest !== plan.digest) {
      throw new ConflictException(
        'Workshop order lines changed since this proposal was created',
      );
    }
    if (parsed.pinned_customer_id !== plan.customerId) {
      throw new ConflictException(
        'The workshop order customer changed since this proposal was created',
      );
    }
    if (parsed.pinned_recipient_pin !== plan.recipientPin) {
      throw new ConflictException(
        'The customer email changed since this proposal was created',
      );
    }
    if (parsed.pinned_needs_create_estimate === true) {
      if (!plan.needsCreateEstimate) {
        throw new ConflictException(
          'The estimate draft plan changed since this proposal was created',
        );
      }
      if (
        parsed.pinned_needs_revision === true ||
        parsed.pinned_draft_version_id
      ) {
        throw new ConflictException(
          'Proposal estimate version pins are inconsistent',
        );
      }
      return;
    }
    if (parsed.pinned_needs_revision === true) {
      if (!plan.needsRevision) {
        throw new ConflictException(
          'The estimate draft plan changed since this proposal was created',
        );
      }
      if (parsed.pinned_draft_version_id) {
        throw new ConflictException(
          'Proposal estimate version pins are inconsistent',
        );
      }
      return;
    }
    if (!parsed.pinned_draft_version_id) {
      throw new ConflictException(
        'Proposal payload is missing required estimate version pins',
      );
    }
    if (plan.draftVersionId !== parsed.pinned_draft_version_id) {
      throw new ConflictException(
        'The estimate draft version changed since this proposal was created',
      );
    }
    if (parsed.pinned_valid_until && plan.validUntilIso) {
      if (parsed.pinned_valid_until !== plan.validUntilIso) {
        throw new ConflictException(
          'The estimate validity changed since this proposal was created',
        );
      }
    }
  }

  private async resolveVersionIdForApply(
    parsed: ProposeEstimateSendInput,
    orderId: string,
    tenantId: string,
    siteId: string,
  ): Promise<string> {
    if (parsed.pinned_draft_version_id) {
      return parsed.pinned_draft_version_id;
    }
    if (parsed.estimate_version_id) {
      return parsed.estimate_version_id;
    }
    if (parsed.pinned_needs_create_estimate) {
      const created = await this.estimates.createForOrder(orderId);
      const draft = created.versions.find(
        (v) => v.status === WorkshopEstimateStatus.DRAFT,
      );
      if (!draft) {
        throw new ConflictException('Failed to create an estimate draft');
      }
      return draft.id;
    }
    if (parsed.pinned_needs_revision) {
      const revision = await this.estimates.createRevision(orderId);
      return revision.id;
    }
    const estimate = await this.prisma.workshopEstimate.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_order_id: orderId,
        site_id: siteId,
      },
      select: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    });
    if (!estimate) {
      const created = await this.estimates.createForOrder(orderId);
      const draft = created.versions.find(
        (v) => v.status === WorkshopEstimateStatus.DRAFT,
      );
      if (!draft) {
        throw new ConflictException('Failed to create an estimate draft');
      }
      return draft.id;
    }
    const latest = estimate.versions[0];
    if (!latest) {
      throw new ConflictException('The estimate has no version to send');
    }
    if (latest.status === WorkshopEstimateStatus.DRAFT) {
      return latest.id;
    }
    const revision = await this.estimates.createRevision(orderId);
    return revision.id;
  }

  private async planSend(
    parsed: ProposeEstimateSendInput,
    tenantId: string,
    siteId: string,
  ) {
    if (parsed.channel !== 'email') {
      throw new UnprocessableEntityException({
        code: 'ESTIMATE_SEND_CHANNEL_UNSUPPORTED',
        message: 'Only the email channel is supported for estimate send.',
      });
    }

    const order = await this.prisma.workshopOrder.findFirst({
      where: {
        id: parsed.workshop_order_id,
        tenant_id: tenantId,
        site_id: siteId,
      },
      select: ORDER_FOR_ESTIMATE_SEND_SELECT,
    });
    if (!order) {
      throw new NotFoundException(
        `Workshop order ${parsed.workshop_order_id} not found`,
      );
    }
    if (!order.customer) {
      throw new UnprocessableEntityException({
        code: 'ESTIMATE_CUSTOMER_REQUIRED',
        message: 'The workshop order needs a customer before sending.',
      });
    }

    const recipientEmail = resolveCustomerEstimateRecipientEmail(
      order.customer,
    );
    const customerId = order.customer.id;
    const recipientPin = pinCustomerEstimateRecipientEmail(
      tenantId,
      customerId,
      recipientEmail,
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
    const pricedLines = buildWorkshopEstimateLines(sourceLines);
    if (pricedLines.length === 0) {
      throw new UnprocessableEntityException({
        code: 'ESTIMATE_NO_LINES',
        message: 'The estimate needs at least one labor or parts line.',
      });
    }

    const digest = this.digestSourceLines(sourceLines);
    const totals = buildWorkshopEstimateTotals(pricedLines);
    const validUntilIso = parsed.valid_until ?? null;

    const draftPlan = await this.resolveDraftVersionIdForPlan(
      parsed,
      order.id,
      tenantId,
      siteId,
    );

    const estimateNumber = draftPlan.estimateNumber ?? 'pending';

    const preview: EstimateSendProposePreview = {
      workshop_order_id: order.id,
      site_id: siteId,
      channel: 'email',
      estimate_number: estimateNumber,
      estimate_version_id: draftPlan.draftVersionId ?? 'pending',
      recipient_email_masked: maskEmailAddress(recipientEmail),
      lines: pricedLines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        net: line.net,
        gross: line.gross,
      })),
      totals: {
        net: totals.total_net,
        vat: totals.total_tax,
        gross: totals.total_gross,
      },
      valid_until: validUntilIso,
    };

    return {
      preview,
      digest,
      recipientEmail,
      customerId,
      recipientPin,
      draftVersionId: draftPlan.draftVersionId,
      needsCreateEstimate: draftPlan.needsCreateEstimate,
      needsRevision: draftPlan.needsRevision,
      validUntilIso,
    };
  }

  private async resolveDraftVersionIdForPlan(
    parsed: ProposeEstimateSendInput,
    orderId: string,
    tenantId: string,
    siteId: string,
  ): Promise<{
    draftVersionId: string | null;
    estimateNumber: string | null;
    needsCreateEstimate: boolean;
    needsRevision: boolean;
  }> {
    if (parsed.estimate_version_id) {
      const version = await this.prisma.workshopEstimateVersion.findFirst({
        where: {
          id: parsed.estimate_version_id,
          tenant_id: tenantId,
          status: WorkshopEstimateStatus.DRAFT,
          estimate: { workshop_order_id: orderId, site_id: siteId },
        },
        select: {
          id: true,
          estimate: { select: { estimate_number: true } },
        },
      });
      if (!version) {
        throw new NotFoundException(
          'Draft workshop estimate version not found for this order',
        );
      }
      return {
        draftVersionId: version.id,
        estimateNumber: version.estimate.estimate_number,
        needsCreateEstimate: false,
        needsRevision: false,
      };
    }

    const estimate = await this.prisma.workshopEstimate.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_order_id: orderId,
        site_id: siteId,
      },
      select: {
        estimate_number: true,
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    });
    if (!estimate) {
      return {
        draftVersionId: null,
        estimateNumber: null,
        needsCreateEstimate: true,
        needsRevision: false,
      };
    }
    const latest = estimate.versions[0];
    if (!latest) {
      throw new ConflictException('The estimate has no version to send');
    }
    if (latest.status === WorkshopEstimateStatus.DRAFT) {
      return {
        draftVersionId: latest.id,
        estimateNumber: estimate.estimate_number,
        needsCreateEstimate: false,
        needsRevision: false,
      };
    }
    return {
      draftVersionId: null,
      estimateNumber: estimate.estimate_number,
      needsCreateEstimate: false,
      needsRevision: true,
    };
  }

  private digestSourceLines(
    lines: Array<{
      id: string;
      type: WorkshopLineItemType;
      item_no: string;
      description: string;
      quantity: Prisma.Decimal;
      unit_price: Prisma.Decimal;
    }>,
  ): string {
    const payload = lines.map((line) => ({
      id: line.id,
      type: line.type,
      item_no: line.item_no,
      description: line.description,
      quantity: line.quantity.toString(),
      unit_price: line.unit_price.toString(),
    }));
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
