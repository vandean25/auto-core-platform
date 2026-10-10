import {
  DiscountType,
  InvoiceStatus,
  Prisma,
  type CustomerType,
  type InvoiceTaxMode,
} from '@prisma/client';
import type { InvoiceSnapshot } from '../invoices/invoice-snapshot.js';
import { isInvoiceSnapshot } from '../invoices/invoice-snapshot.validation.js';
import type { InvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.js';
import { isInvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.validation.js';
import { fitMcpRowsToCap } from './mcp-output.util.js';

/** Statuses whose amounts were frozen into a snapshot when the invoice was committed. */
const COMMITTED_STATUSES = new Set<InvoiceStatus>([
  InvoiceStatus.FINALIZED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
  InvoiceStatus.CANCELLED,
]);

export type McpInvoiceCustomer = {
  id: string;
  type: CustomerType;
  company_name: string | null;
  first_name: string;
  last_name: string;
};

export type McpInvoiceListRecord = {
  id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  date: Date;
  currency: string | null;
  total_gross: Prisma.Decimal;
  snapshot: unknown;
  customer: McpInvoiceCustomer;
};

export type McpInvoiceLine = {
  description: string;
  quantity: string;
  unit_net: string;
  tax_rate: string;
  net: string | null;
  gross: string | null;
};

export type McpInvoiceSeller = InvoiceSnapshotV2['seller'];

export type McpInvoiceTotals = { net: string; tax: string; gross: string };

export type McpCreditNoteRecord = {
  id: string;
  credit_number: string | null;
  status: string;
  total_gross: Prisma.Decimal;
  finalized_at: Date | null;
};

export type McpInvoiceDetailRecord = McpInvoiceListRecord & {
  tax_mode: InvoiceTaxMode;
  due_date: Date;
  total_net: Prisma.Decimal;
  total_tax: Prisma.Decimal;
  global_discount_type: DiscountType | null;
  snapshot: unknown;
  workshop_order_id: string | null;
  sales_order_id: string | null;
  items: Array<{
    description: string;
    quantity: Prisma.Decimal;
    unit_price: Prisma.Decimal;
    tax_rate: Prisma.Decimal;
    line_discount_type: DiscountType | null;
    line_discount_value: Prisma.Decimal | null;
  }>;
  credit_notes: McpCreditNoteRecord[];
};

/**
 * Customer name as the invoice PDF prints it: company name for a company
 * customer, otherwise first and last name. Contact data is never read here.
 */
export function mcpCustomerName(
  customer: Pick<
    McpInvoiceCustomer,
    'type' | 'company_name' | 'first_name' | 'last_name'
  >,
): string {
  const person = `${customer.first_name} ${customer.last_name}`;
  return customer.type === 'COMPANY'
    ? (customer.company_name ?? person)
    : person;
}

/**
 * Gross total for a list row. A committed invoice with a usable snapshot shows
 * the snapshot total, the same figure the PDF prints and `get_invoice` reports.
 * The stored column is written once at draft creation and can differ from the
 * snapshot, because the snapshot rounds tax per line. A draft, or a committed
 * invoice without a usable snapshot, shows its stored total.
 */
export function listGrossTotal(
  record: Pick<McpInvoiceListRecord, 'status' | 'snapshot' | 'total_gross'>,
): string {
  if (COMMITTED_STATUSES.has(record.status)) {
    if (isInvoiceSnapshotV2(record.snapshot)) {
      return record.snapshot.total_gross;
    }
    if (isInvoiceSnapshot(record.snapshot)) {
      return record.snapshot.total_gross;
    }
  }
  return record.total_gross.toFixed(2);
}

export function toMcpInvoiceListRow(record: McpInvoiceListRecord) {
  return {
    id: record.id,
    number: record.invoice_number,
    status: record.status,
    customer: {
      id: record.customer.id,
      name: mcpCustomerName(record.customer),
    },
    issued_at: record.date.toISOString(),
    total_gross: listGrossTotal(record),
    currency: record.currency ?? 'EUR',
  };
}

export function toMcpCreditNote(record: McpCreditNoteRecord) {
  return {
    id: record.id,
    number: record.credit_number,
    status: record.status,
    total_gross: record.total_gross.toFixed(2),
    issued_at: record.finalized_at?.toISOString() ?? null,
  };
}

/**
 * Detail for one invoice. Amounts come from the same source the PDF renders:
 * the committed V2 snapshot (lines, totals, and seller), a committed V1
 * snapshot (totals and net lines), or the stored invoice rows for drafts and
 * any invoice without a usable snapshot. `amount_source` says which one.
 */
export function toMcpInvoiceDetail(
  invoice: McpInvoiceDetailRecord,
  orderNumbers: ReadonlyMap<string, string>,
) {
  const amounts = resolveAmounts(invoice);
  const detail = {
    id: invoice.id,
    number: invoice.invoice_number,
    status: invoice.status,
    tax_mode: invoice.tax_mode,
    currency: invoice.currency ?? 'EUR',
    issued_at: invoice.date.toISOString(),
    due_date: invoice.due_date.toISOString(),
    amount_source: amounts.source,
    customer: {
      id: invoice.customer.id,
      name: mcpCustomerName(invoice.customer),
    },
    workshop_order: orderLink(invoice.workshop_order_id, orderNumbers),
    sales_order: orderLink(invoice.sales_order_id, orderNumbers),
    seller: amounts.seller,
    totals: amounts.totals,
    credit_notes: invoice.credit_notes.map(toMcpCreditNote),
  };

  const withLines = (lines: readonly McpInvoiceLine[]) => ({
    ...detail,
    lines,
    lines_total: amounts.lines.length,
    lines_truncated: lines.length < amounts.lines.length,
  });
  return withLines(fitMcpRowsToCap(amounts.lines, withLines).rows);
}

type ResolvedAmounts = {
  source: 'snapshot' | 'stored';
  totals: McpInvoiceTotals;
  lines: McpInvoiceLine[];
  seller: McpInvoiceSeller | null;
};

function resolveAmounts(invoice: McpInvoiceDetailRecord): ResolvedAmounts {
  if (COMMITTED_STATUSES.has(invoice.status)) {
    if (isInvoiceSnapshotV2(invoice.snapshot)) {
      return fromSnapshotV2(invoice.snapshot);
    }
    if (isInvoiceSnapshot(invoice.snapshot)) {
      return fromSnapshotV1(invoice.snapshot);
    }
  }
  return fromStoredRows(invoice);
}

function fromSnapshotV2(snapshot: InvoiceSnapshotV2): ResolvedAmounts {
  return {
    source: 'snapshot',
    totals: {
      net: snapshot.total_net,
      tax: snapshot.total_tax,
      gross: snapshot.total_gross,
    },
    lines: snapshot.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_net: item.unit_price,
      tax_rate: item.tax_rate,
      net: item.net,
      gross: item.gross,
    })),
    seller: { ...snapshot.seller },
  };
}

/**
 * V1 snapshots carry totals and unit prices but no per-line amounts that can
 * be read without guessing their basis, so line net and gross stay null.
 */
function fromSnapshotV1(snapshot: InvoiceSnapshot): ResolvedAmounts {
  return {
    source: 'snapshot',
    totals: {
      net: snapshot.total_net,
      tax: snapshot.total_tax,
      gross: snapshot.total_gross,
    },
    lines: snapshot.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_net: item.unit_price,
      tax_rate: item.tax_rate,
      net: null,
      gross: null,
    })),
    seller: null,
  };
}

/**
 * Drafts and invoices without a usable snapshot. Each line follows the snapshot
 * builder's arithmetic: quantity times unit price, less the line discount. Tax
 * is computed from the unrounded net and rounded half-up, and gross is the
 * unrounded net plus that tax; the displayed net and gross are rounded only for
 * output. Margin-scheme lines carry no tax, so their gross equals their net. An
 * invoice-level discount is not allocated to lines here, so its lines report
 * null amounts; the stored totals still apply.
 */
function fromStoredRows(invoice: McpInvoiceDetailRecord): ResolvedAmounts {
  const hasGlobalDiscount = invoice.global_discount_type !== null;
  const isMarginScheme = invoice.tax_mode === 'MARGIN_SCHEME';
  return {
    source: 'stored',
    totals: {
      net: invoice.total_net.toFixed(2),
      tax: invoice.total_tax.toFixed(2),
      gross: invoice.total_gross.toFixed(2),
    },
    lines: invoice.items.map((item) => {
      const base = {
        description: item.description,
        quantity: item.quantity.toFixed(3),
        unit_net: item.unit_price.toFixed(2),
        tax_rate: item.tax_rate.toFixed(2),
      };
      if (hasGlobalDiscount) {
        return { ...base, net: null, gross: null };
      }
      const lineNet = storedLineNet(item);
      const tax = isMarginScheme
        ? new Prisma.Decimal(0)
        : halfUpTax(lineNet, item.tax_rate);
      return {
        ...base,
        net: lineNet.toFixed(2),
        gross: lineNet.add(tax).toFixed(2),
      };
    }),
    seller: null,
  };
}

function storedLineNet(item: McpInvoiceDetailRecord['items'][number]) {
  const grossLine = item.quantity.mul(item.unit_price);
  if (!item.line_discount_type || item.line_discount_value === null) {
    return grossLine;
  }
  if (item.line_discount_type === DiscountType.PERCENTAGE) {
    return grossLine.sub(
      grossLine.mul(item.line_discount_value).div(100).toDecimalPlaces(2),
    );
  }
  return Prisma.Decimal.max(
    grossLine.sub(item.line_discount_value),
    new Prisma.Decimal(0),
  );
}

function halfUpTax(net: Prisma.Decimal, rate: Prisma.Decimal): Prisma.Decimal {
  return net
    .mul(rate)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function orderLink(
  orderId: string | null,
  orderNumbers: ReadonlyMap<string, string>,
) {
  return orderId
    ? { id: orderId, order_number: orderNumbers.get(orderId) ?? null }
    : null;
}
