import { InvoiceTaxMode, Prisma } from '@prisma/client';
import type {
  RevenueReportAmounts,
  RevenueReportCore,
  RevenueReportSource,
} from './finance-revenue-report.types.js';

const ZERO = new Prisma.Decimal(0);

export type RevenueInvoiceRow = {
  id: string;
  tax_mode: InvoiceTaxMode;
  workshop_order_id: string | null;
  vehicle_sale_id: string | null;
  total_net: Prisma.Decimal;
  total_tax: Prisma.Decimal;
  total_gross: Prisma.Decimal;
  items: Array<{
    id: string;
    revenue_group_name: string | null;
    quantity: Prisma.Decimal;
    unit_price: Prisma.Decimal;
    line_total: Prisma.Decimal | null;
    tax_rate: Prisma.Decimal;
  }>;
};

export type RevenueCreditNoteRow = {
  id: string;
  total_net: Prisma.Decimal;
  total_tax: Prisma.Decimal;
  total_gross: Prisma.Decimal;
  original_invoice: {
    workshop_order_id: string | null;
    vehicle_sale_id: string | null;
    tax_mode: InvoiceTaxMode;
  };
  items: Array<{
    snapshot: unknown;
    original_invoice_item: {
      revenue_group_name: string | null;
    };
  }>;
};

function amountsFromParts(
  net: Prisma.Decimal,
  vat: Prisma.Decimal,
  gross: Prisma.Decimal,
): RevenueReportAmounts {
  return { net, vat, gross };
}

function addAmounts(
  left: RevenueReportAmounts,
  right: RevenueReportAmounts,
): RevenueReportAmounts {
  return {
    net: left.net.add(right.net),
    vat: left.vat.add(right.vat),
    gross: left.gross.add(right.gross),
  };
}

function subtractAmounts(
  left: RevenueReportAmounts,
  right: RevenueReportAmounts,
): RevenueReportAmounts {
  return {
    net: left.net.sub(right.net),
    vat: left.vat.sub(right.vat),
    gross: left.gross.sub(right.gross),
  };
}

function emptyAmounts(): RevenueReportAmounts {
  return { net: ZERO, vat: ZERO, gross: ZERO };
}

function revenueGroupLabel(name: string | null | undefined): string {
  return name?.trim() ? name : 'Other';
}

export function classifyRevenueSource(input: {
  workshop_order_id: string | null;
  vehicle_sale_id: string | null;
}): RevenueReportSource {
  if (input.workshop_order_id) {
    return 'workshop';
  }
  if (input.vehicle_sale_id) {
    return 'vehicle_sales';
  }
  return 'other';
}

function lineNet(item: RevenueInvoiceRow['items'][number]): Prisma.Decimal {
  if (item.line_total !== null) {
    return item.line_total;
  }
  return item.quantity.mul(item.unit_price);
}

function lineTax(
  net: Prisma.Decimal,
  taxRate: Prisma.Decimal,
): Prisma.Decimal {
  return net.mul(taxRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function standardLineAmounts(
  item: RevenueInvoiceRow['items'][number],
): RevenueReportAmounts {
  const net = lineNet(item);
  const vat = lineTax(net, item.tax_rate);
  return amountsFromParts(net, vat, net.add(vat));
}

function readCreditLineAmounts(snapshot: unknown): RevenueReportAmounts | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const row = snapshot as {
    net?: unknown;
    tax?: unknown;
    gross?: unknown;
  };
  if (
    typeof row.net !== 'string' ||
    typeof row.tax !== 'string' ||
    typeof row.gross !== 'string'
  ) {
    return null;
  }
  return amountsFromParts(
    new Prisma.Decimal(row.net),
    new Prisma.Decimal(row.tax),
    new Prisma.Decimal(row.gross),
  );
}

function sortedItems<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function addToMap(
  map: Map<string, RevenueReportAmounts>,
  key: string,
  delta: RevenueReportAmounts,
): void {
  const current = map.get(key) ?? emptyAmounts();
  map.set(key, addAmounts(current, delta));
}

function subtractFromMap(
  map: Map<string, RevenueReportAmounts>,
  key: string,
  delta: RevenueReportAmounts,
): void {
  const current = map.get(key) ?? emptyAmounts();
  map.set(key, subtractAmounts(current, delta));
}

function invoiceDocumentAmounts(invoice: RevenueInvoiceRow): RevenueReportAmounts {
  return amountsFromParts(
    invoice.total_net,
    invoice.total_tax,
    invoice.total_gross,
  );
}

function applyInvoice(
  invoice: RevenueInvoiceRow,
  bySource: Map<RevenueReportSource, RevenueReportAmounts>,
  byGroup: Map<string, RevenueReportAmounts>,
): void {
  const source = classifyRevenueSource(invoice);
  if (invoice.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
    const document = invoiceDocumentAmounts(invoice);
    addToMap(bySource, source, document);
    const primaryGroup = revenueGroupLabel(
      sortedItems(invoice.items)[0]?.revenue_group_name,
    );
    addToMap(byGroup, primaryGroup, document);
    return;
  }

  let document = emptyAmounts();
  for (const item of sortedItems(invoice.items)) {
    const line = standardLineAmounts(item);
    document = addAmounts(document, line);
    addToMap(byGroup, revenueGroupLabel(item.revenue_group_name), line);
  }
  addToMap(bySource, source, document);
}

function applyCreditNote(
  creditNote: RevenueCreditNoteRow,
  bySource: Map<RevenueReportSource, RevenueReportAmounts>,
  byGroup: Map<string, RevenueReportAmounts>,
): void {
  const source = classifyRevenueSource(creditNote.original_invoice);
  const document = amountsFromParts(
    creditNote.total_net,
    creditNote.total_tax,
    creditNote.total_gross,
  );
  subtractFromMap(bySource, source, document);

  if (creditNote.original_invoice.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
    const primaryGroup = revenueGroupLabel(
      creditNote.items[0]?.original_invoice_item.revenue_group_name,
    );
    subtractFromMap(byGroup, primaryGroup, document);
    return;
  }

  for (const item of creditNote.items) {
    const line =
      readCreditLineAmounts(item.snapshot) ??
      emptyAmounts();
    subtractFromMap(
      byGroup,
      revenueGroupLabel(item.original_invoice_item.revenue_group_name),
      line,
    );
  }
}

function mapToSourceRows(
  bySource: Map<RevenueReportSource, RevenueReportAmounts>,
): RevenueReportCore['by_source'] {
  const order: RevenueReportSource[] = [
    'workshop',
    'vehicle_sales',
    'other',
  ];
  return order.map((source) => ({
    source,
    ...(bySource.get(source) ?? emptyAmounts()),
  }));
}

function mapToGroupRows(
  byGroup: Map<string, RevenueReportAmounts>,
): RevenueReportCore['by_revenue_group'] {
  return [...byGroup.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, amounts]) => ({ name, ...amounts }));
}

function sumTotals(bySource: Map<RevenueReportSource, RevenueReportAmounts>) {
  return [...bySource.values()].reduce(
    (total, row) => addAmounts(total, row),
    emptyAmounts(),
  );
}

/** Pure aggregation for invoices and finalized credit notes in one pass. */
export function aggregateRevenueReport(input: {
  period: RevenueReportCore['period'];
  site_id: string | null;
  invoices: readonly RevenueInvoiceRow[];
  creditNotes: readonly RevenueCreditNoteRow[];
}): RevenueReportCore {
  const bySource = new Map<RevenueReportSource, RevenueReportAmounts>();
  const byGroup = new Map<string, RevenueReportAmounts>();

  for (const invoice of input.invoices) {
    applyInvoice(invoice, bySource, byGroup);
  }
  for (const creditNote of input.creditNotes) {
    applyCreditNote(creditNote, bySource, byGroup);
  }

  return {
    period: input.period,
    site_id: input.site_id,
    totals: sumTotals(bySource),
    by_source: mapToSourceRows(bySource),
    by_revenue_group: mapToGroupRows(byGroup),
    invoice_count: input.invoices.length,
  };
}

/** Legacy chart slices: net per revenue group using the same margin rules as the report. */
export function legacyAnalyticsByGroup(
  invoices: readonly RevenueInvoiceRow[],
): Map<string, Prisma.Decimal> {
  const byGroup = new Map<string, RevenueReportAmounts>();
  const bySource = new Map<RevenueReportSource, RevenueReportAmounts>();
  for (const invoice of invoices) {
    applyInvoice(invoice, bySource, byGroup);
  }
  return new Map(
    [...byGroup.entries()].map(([name, amounts]) => [name, amounts.net]),
  );
}
