import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MCP_DEFAULT_PAGE_SIZE } from './mcp.constants.js';
import { buildMcpKeysetPage, keysetCursorOf } from './mcp-audit-read.mapper.js';
import {
  toMcpInvoiceDetail,
  toMcpInvoiceListRow,
} from './mcp-invoice-read.mapper.js';
import {
  decodeMcpKeysetCursor,
  normalizeMcpRangeEnd,
  normalizeMcpRangeStart,
  type McpKeysetCursor,
} from './mcp-output.util.js';
import type {
  getInvoiceInputSchema,
  listInvoicesInputSchema,
} from './mcp-tool-schemas.js';

type ListInvoicesInput = z.infer<typeof listInvoicesInputSchema>;
type GetInvoiceInput = z.infer<typeof getInvoiceInputSchema>;

const INVOICES_NEWEST_FIRST: Prisma.InvoiceOrderByWithRelationInput[] = [
  { date: 'desc' },
  { id: 'desc' },
];

const CUSTOMER_SELECT = {
  id: true,
  type: true,
  company_name: true,
  first_name: true,
  last_name: true,
} as const;

const LIST_SELECT = {
  id: true,
  invoice_number: true,
  status: true,
  date: true,
  currency: true,
  total_gross: true,
  customer: { select: CUSTOMER_SELECT },
} as const;

function decodeCursorOrThrow(cursor: string): McpKeysetCursor {
  const decoded = decodeMcpKeysetCursor(cursor);
  if (!decoded) {
    throw new BadRequestException('cursor is invalid');
  }
  return decoded;
}

/** Invoices strictly older than the cursor, for newest-first pages. */
function invoicesOlderThan(cursor: McpKeysetCursor): Prisma.InvoiceWhereInput {
  const at = new Date(cursor.at);
  return {
    OR: [{ date: { lt: at } }, { date: at, id: { lt: cursor.id } }],
  };
}

/**
 * Read-only invoice tools. Every query is scoped by the tenant from the session
 * and by the active site (ADR-0022), matching the vehicle stock margin report.
 * Amounts, lines, and the seller block come from the committed snapshot when
 * one exists, the same source the PDF renders.
 */
@Injectable()
export class McpInvoiceReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly siteContext: SiteContextService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listInvoices(input: ListInvoicesInput) {
    const { tenantId, siteId } = await this.scope();
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;

    const where: Prisma.InvoiceWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
    };
    if (input.status) {
      where.status = input.status;
    }
    if (input.customer_id) {
      where.customer_id = input.customer_id;
    }
    if (input.order_id) {
      where.OR = [
        { workshop_order_id: input.order_id },
        { sales_order_id: input.order_id },
      ];
    }
    if (input.number) {
      where.invoice_number = { contains: input.number, mode: 'insensitive' };
    }
    if (input.from || input.to) {
      where.date = {
        ...(input.from
          ? { gte: new Date(normalizeMcpRangeStart(input.from)) }
          : {}),
        ...(input.to ? { lte: new Date(normalizeMcpRangeEnd(input.to)) } : {}),
      };
    }
    if (input.cursor) {
      where.AND = [invoicesOlderThan(decodeCursorOrThrow(input.cursor))];
    }

    const records = await this.prisma.invoice.findMany({
      where,
      orderBy: INVOICES_NEWEST_FIRST,
      take: pageSize + 1,
      select: LIST_SELECT,
    });
    return buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.date, record.id),
      mapRow: toMcpInvoiceListRow,
    });
  }

  async getInvoice(input: GetInvoiceInput) {
    const { tenantId, siteId } = await this.scope();
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: input.invoice_id, tenant_id: tenantId, site_id: siteId },
      select: {
        id: true,
        invoice_number: true,
        status: true,
        tax_mode: true,
        currency: true,
        date: true,
        due_date: true,
        total_net: true,
        total_tax: true,
        total_gross: true,
        global_discount_type: true,
        snapshot: true,
        workshop_order_id: true,
        sales_order_id: true,
        customer: { select: CUSTOMER_SELECT },
        items: {
          where: { tenant_id: tenantId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            description: true,
            quantity: true,
            unit_price: true,
            tax_rate: true,
            line_discount_type: true,
            line_discount_value: true,
          },
        },
        credit_notes: {
          where: { tenant_id: tenantId, site_id: siteId },
          orderBy: [{ date: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            credit_number: true,
            status: true,
            total_gross: true,
            finalized_at: true,
          },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException(
        `Invoice with ID ${input.invoice_id} not found`,
      );
    }

    const orderNumbers = await this.orderNumbers(invoice, tenantId, siteId);
    return toMcpInvoiceDetail(invoice, orderNumbers);
  }

  private async scope(): Promise<{ tenantId: string; siteId: string }> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    return { tenantId, siteId };
  }

  /** Order numbers for the linked orders, read only when they belong to the active site. */
  private async orderNumbers(
    invoice: {
      workshop_order_id: string | null;
      sales_order_id: string | null;
    },
    tenantId: string,
    siteId: string,
  ): Promise<Map<string, string>> {
    const [workshopOrder, salesOrder] = await Promise.all([
      invoice.workshop_order_id
        ? this.prisma.workshopOrder.findFirst({
            where: {
              id: invoice.workshop_order_id,
              tenant_id: tenantId,
              site_id: siteId,
            },
            select: { id: true, order_number: true },
          })
        : null,
      invoice.sales_order_id
        ? this.prisma.salesOrder.findFirst({
            where: {
              id: invoice.sales_order_id,
              tenant_id: tenantId,
              site_id: siteId,
            },
            select: { id: true, order_number: true },
          })
        : null,
    ]);

    const numbers = new Map<string, string>();
    for (const order of [workshopOrder, salesOrder]) {
      if (order) {
        numbers.set(order.id, order.order_number);
      }
    }
    return numbers;
  }
}
