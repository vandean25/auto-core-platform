import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerType,
  InvoiceStatus,
  Prisma,
  WorkshopOrderPurpose,
} from '@prisma/client';
import { formatCustomerName } from '../agent-proposal/agent-proposal-order-summary.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { assertBackOfficeRole } from '../workshop/workshop-estimate-scope.js';
import {
  assertOrderInvoiceable,
  buildDraftInvoiceLinesFromOrder,
  buildInvoiceCustomerAddressSnapshot,
  findWorkshopOrderForDraftInvoice,
  type WorkshopOrderForDraftInvoice,
} from './invoice-creation.helpers.js';
import { InvoicesService } from './invoices.service.js';
import {
  proposeInvoiceDraftFromOrderInputSchema,
  type ProposeInvoiceDraftFromOrderInput,
} from './invoice-workshop-draft-propose.schema.js';

export const INVOICE_DRAFT_FINALIZE_NOTE =
  'Invoice remains DRAFT until a human finalizes it in the back office.';

export type InvoiceDraftProposeLinePreview = {
  description: string;
  quantity: string;
  unit_net: string;
  tax_rate: string;
  net: string;
  gross: string;
};

export type InvoiceDraftProposeRecipientPreview = {
  customer_id: string;
  name: string;
  address: {
    street: string;
    city: string;
    postal_code: string;
    country: string;
  };
};

export type InvoiceDraftProposePreview = {
  workshop_order_id: string;
  site_id: string;
  recipient: InvoiceDraftProposeRecipientPreview;
  lines: InvoiceDraftProposeLinePreview[];
  totals: { net: string; vat: string; gross: string };
};

export type InvoiceDraftProposeResult = InvoiceDraftProposePreview & {
  id: string;
  entityId: string;
  invoice_id: string;
  status: 'DRAFT';
  finalize_note: string;
};

function halfUpTax(net: Prisma.Decimal, rate: Prisma.Decimal): Prisma.Decimal {
  return net.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function mapLinePreview(
  line: {
    description: string;
    quantity: Prisma.Decimal | number | string;
    unit_price?: Prisma.Decimal | number | string;
    unitPrice?: Prisma.Decimal | number | string;
    tax_rate?: Prisma.Decimal | number | string;
    taxRate?: Prisma.Decimal | number | string;
  },
): InvoiceDraftProposeLinePreview {
  const quantity = new Prisma.Decimal(line.quantity);
  const unitNet = new Prisma.Decimal(line.unit_price ?? line.unitPrice ?? 0);
  const taxRate = new Prisma.Decimal(line.tax_rate ?? line.taxRate ?? 20);
  const lineNet = quantity.mul(unitNet).toDecimalPlaces(2);
  const tax = halfUpTax(lineNet, taxRate);
  return {
    description: line.description,
    quantity: quantity.toFixed(3),
    unit_net: unitNet.toFixed(2),
    tax_rate: taxRate.toFixed(2),
    net: lineNet.toFixed(2),
    gross: lineNet.add(tax).toFixed(2),
  };
}

@Injectable()
export class InvoiceWorkshopDraftProposeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly invoicesService: InvoicesService,
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
    const parsed = proposeInvoiceDraftFromOrderInputSchema.parse(record);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const plan = await this.planDraft(parsed.workshop_order_id, tenantId, siteId);
    record.pinned_workshop_order_id = parsed.workshop_order_id;
    record.pinned_billable_digest = plan.digest;
    return record;
  }

  async buildPolicyContext(
    input: unknown,
  ): Promise<{ amount_eur: number }> {
    const parsed = proposeInvoiceDraftFromOrderInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const plan = await this.planDraft(parsed.workshop_order_id, tenantId, siteId);
    return { amount_eur: Number(plan.preview.totals.gross) };
  }

  async applyDraft(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<InvoiceDraftProposeResult> {
    assertBackOfficeRole(
      this.tenantContext,
      'Creating workshop invoice drafts through MCP',
    );
    const parsed = proposeInvoiceDraftFromOrderInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const expectedSiteId =
      typeof executionContext?.site_id === 'string'
        ? executionContext.site_id
        : await this.siteContext.getSiteId();

    const orderId =
      parsed.pinned_workshop_order_id ?? parsed.workshop_order_id;
    if (orderId !== parsed.workshop_order_id) {
      throw new ConflictException(
        'Workshop order id does not match the pinned proposal order',
      );
    }

    const plan = await this.planDraft(orderId, tenantId, expectedSiteId);
    this.assertPinnedDigest(parsed, plan.digest);

    const invoice = await this.invoicesService.createDraftInvoice(orderId);
    const mapped = this.mapCreatedInvoice(
      invoice,
      plan.preview,
      orderId,
      expectedSiteId,
    );
    this.assertPreviewTotalsMatch(plan.preview, mapped);
    return mapped;
  }

  private assertPinnedDigest(
    parsed: ProposeInvoiceDraftFromOrderInput,
    digest: string,
  ): void {
    if (
      parsed.pinned_billable_digest &&
      parsed.pinned_billable_digest !== digest
    ) {
      throw new ConflictException(
        'Workshop order billable lines changed since this proposal was created',
      );
    }
  }

  private assertPreviewTotalsMatch(
    preview: InvoiceDraftProposePreview,
    result: InvoiceDraftProposeResult,
  ): void {
    if (
      result.totals.net !== preview.totals.net ||
      result.totals.vat !== preview.totals.vat ||
      result.totals.gross !== preview.totals.gross
    ) {
      throw new ConflictException(
        'Created invoice totals do not match the proposal preview',
      );
    }
  }

  private async planDraft(
    workshopOrderId: string,
    tenantId: string,
    siteId: string,
  ) {
    const order = await findWorkshopOrderForDraftInvoice(
      this.prisma,
      tenantId,
      siteId,
      workshopOrderId,
    );
    if (!order) {
      throw new NotFoundException(
        `Workshop order ${workshopOrderId} not found`,
      );
    }
    if (order.purpose === WorkshopOrderPurpose.STOCK_PREP) {
      throw new ConflictException(
        'Stock-prep workshop orders cannot be invoiced to a customer',
      );
    }
    assertOrderInvoiceable(order);
    const preview = this.buildPreviewFromOrder(order, tenantId, siteId);
    const digest = this.digestBillableLines(order, tenantId);
    return { preview, digest };
  }

  private buildPreviewFromOrder(
    order: WorkshopOrderForDraftInvoice,
    tenantId: string,
    siteId: string,
  ): InvoiceDraftProposePreview {
    const customer = order.customer;
    if (!customer?.id) {
      throw new ConflictException('Workshop order has no customer to invoice');
    }
    const address = buildInvoiceCustomerAddressSnapshot(customer);
    const { lineItems, totals } = buildDraftInvoiceLinesFromOrder(
      order,
      tenantId,
    );
    const lines = lineItems.map((line) => mapLinePreview(line));

    return {
      workshop_order_id: order.id,
      site_id: siteId,
      recipient: {
        customer_id: customer.id,
        name: formatCustomerName(customer) ?? 'Customer',
        address,
      },
      lines,
      totals: {
        net: totals.totalNet.toDecimalPlaces(2).toFixed(2),
        vat: totals.totalTax.toDecimalPlaces(2).toFixed(2),
        gross: totals.totalGross.toDecimalPlaces(2).toFixed(2),
      },
    };
  }

  private digestBillableLines(
    order: WorkshopOrderForDraftInvoice,
    tenantId: string,
  ): string {
    const { lineItems } = buildDraftInvoiceLinesFromOrder(order, tenantId);
    const payload = lineItems.map((line) => ({
      description: line.description,
      quantity: String(line.quantity),
      unit_price: String(line.unit_price ?? line.unitPrice ?? 0),
      tax_rate: String(line.tax_rate ?? line.taxRate ?? ''),
      type: line.type ?? null,
      catalog_item_id: line.catalog_item_id ?? line.catalogItemId ?? null,
    }));
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private mapCreatedInvoice(
    invoice: {
      id: string;
      status: InvoiceStatus;
      total_net: Prisma.Decimal;
      total_tax: Prisma.Decimal;
      total_gross: Prisma.Decimal;
      items: Array<{
        description: string;
        quantity: Prisma.Decimal;
        unit_price: Prisma.Decimal;
        tax_rate: Prisma.Decimal;
      }>;
      customer: {
        id: string;
        type: CustomerType;
        company_name: string | null;
        first_name: string | null;
        last_name: string | null;
        address_street: string | null;
        address_city: string | null;
        address_zip: string | null;
        address_country: string | null;
        street?: string | null;
        city?: string | null;
        postal_code?: string | null;
        country?: string | null;
      };
    },
    preview: InvoiceDraftProposePreview,
    workshopOrderId: string,
    siteId: string,
  ): InvoiceDraftProposeResult {
    const lines = invoice.items.map((item) =>
      mapLinePreview({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
      }),
    );
    const address = buildInvoiceCustomerAddressSnapshot(invoice.customer);
    return {
      id: invoice.id,
      entityId: invoice.id,
      invoice_id: invoice.id,
      status: 'DRAFT',
      workshop_order_id: workshopOrderId,
      site_id: siteId,
      recipient: {
        customer_id: invoice.customer.id,
        name: preview.recipient.name,
        address,
      },
      lines,
      totals: {
        net: invoice.total_net.toFixed(2),
        vat: invoice.total_tax.toFixed(2),
        gross: invoice.total_gross.toFixed(2),
      },
      finalize_note: INVOICE_DRAFT_FINALIZE_NOTE,
    };
  }
}
