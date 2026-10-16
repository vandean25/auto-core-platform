import { DiscountType, InvoiceTaxMode, Prisma } from '@prisma/client';
import { computeStandardInvoiceBilledLineAmounts } from '../invoices/invoice-snapshot-v2.js';
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
  global_discount_type: DiscountType | null;
  global_discount_value: Prisma.Decimal | null;
  total_net: Prisma.Decimal;
  total_tax: Prisma.Decimal;
  total_gross: Prisma.Decimal;
  items: Array<{
    id: string;
    revenue_group_name: string | null;
    quantity: Prisma.Decimal;
    unit_price: Prisma.Decimal;
    line_total: Prisma.Decimal | null;
    line_discount_type: DiscountType | null;
    line_discount_value: Prisma.Decimal | null;
    tax_rate: Prisma.Decimal;
  }>;
};

export type RevenueCreditNoteRow = {
  id: string;
  total_net: Prisma.Decimal;
  total_tax: Prisma.Decimal;
  total_gross: Prisma.Decimal;
  snapshot: unknown;
  original_invoice: {
    workshop_order_id: string | null;
    vehicle_sale_id: string | null;
    tax_mode: InvoiceTaxMode;
    total_tax: Prisma.Decimal;
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

function hasGlobalDiscount(invoice: RevenueInvoiceRow): boolean {
  return (
    invoice.global_discount_type !== null &&
    invoice.global_discount_value !== null
  );
}

function hasLineDiscount(item: RevenueInvoiceRow['items'][number]): boolean {
  return item.line_discount_type !== null && item.line_discount_value !== null;
}

function legacyUndiscountedLineAmounts(
  item: RevenueInvoiceRow['items'][number],
): RevenueReportAmounts {
  const net =
    item.line_total !== null
      ? item.line_total
      : item.quantity.mul(item.unit_price);
  const vat = net
    .mul(item.tax_rate)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return amountsFromParts(net, vat, net.add(vat));
}

function standardInvoiceLineAmounts(
  invoice: RevenueInvoiceRow,
  billedByLineId: Map<string, RevenueReportAmounts>,
  item: RevenueInvoiceRow['items'][number],
  options?: { legacyUndiscountedNet?: boolean },
): RevenueReportAmounts {
  if (
    options?.legacyUndiscountedNet &&
    !hasGlobalDiscount(invoice) &&
    !hasLineDiscount(item)
  ) {
    return legacyUndiscountedLineAmounts(item);
  }
  return (
    billedByLineId.get(item.id) ?? {
      net: ZERO,
      vat: ZERO,
      gross: ZERO,
    }
  );
}

function standardInvoiceBilledLines(
  invoice: RevenueInvoiceRow,
): Map<string, RevenueReportAmounts> {
  const billed = computeStandardInvoiceBilledLineAmounts(
    invoice.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      taxRate: item.tax_rate,
      lineDiscountType: item.line_discount_type,
      lineDiscountValue: item.line_discount_value,
    })),
    invoice.global_discount_type,
    invoice.global_discount_value,
  );
  const amounts = new Map<string, RevenueReportAmounts>();
  for (const [id, line] of billed.entries()) {
    amounts.set(id, amountsFromParts(line.net, line.tax, line.gross));
  }
  return amounts;
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

/**
 * Margin-scheme revenue in the report: `gross` is the amount due after any trade-in
 * allowance (`total_gross`); `vat` is margin VAT (`total_tax`); `net` is gross minus VAT
 * so net + VAT = gross. This matches the no-trade-in chart net (sale price minus margin VAT).
 */
function marginDocumentAmounts(
  invoice: RevenueInvoiceRow,
): RevenueReportAmounts {
  const vat = invoice.total_tax;
  const gross = invoice.total_gross;
  const net = gross.sub(vat);
  return amountsFromParts(net, vat, gross);
}

const MARGIN_TAX_PATTERN = /^\d+\.\d{2}$/;

function readMarginTaxFromCreditSnapshot(
  snapshot: unknown,
): Prisma.Decimal | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const margin = (snapshot as { margin?: unknown }).margin;
  if (!margin || typeof margin !== 'object') {
    return null;
  }
  const marginTax = (margin as { margin_tax?: unknown }).margin_tax;
  if (typeof marginTax !== 'string' || !MARGIN_TAX_PATTERN.test(marginTax)) {
    return null;
  }
  return new Prisma.Decimal(marginTax);
}

/**
 * Margin-scheme credits store `total_tax` as zero; margin VAT lives on the snapshot
 * (`margin.margin_tax`), matching invoices where VAT is `total_tax` on the document.
 */
function marginCreditNoteDocumentAmounts(
  creditNote: RevenueCreditNoteRow,
): RevenueReportAmounts {
  const gross = creditNote.total_gross;
  const vat =
    readMarginTaxFromCreditSnapshot(creditNote.snapshot) ??
    creditNote.original_invoice.total_tax;
  const net = gross.sub(vat);
  return amountsFromParts(net, vat, gross);
}

function applyInvoice(
  invoice: RevenueInvoiceRow,
  bySource: Map<RevenueReportSource, RevenueReportAmounts>,
  byGroup: Map<string, RevenueReportAmounts>,
  options?: { legacyUndiscountedNet?: boolean },
): void {
  const source = classifyRevenueSource(invoice);
  if (invoice.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
    const document = marginDocumentAmounts(invoice);
    addToMap(bySource, source, document);
    const primaryGroup = revenueGroupLabel(
      sortedItems(invoice.items)[0]?.revenue_group_name,
    );
    addToMap(byGroup, primaryGroup, document);
    return;
  }

  const billedByLineId = standardInvoiceBilledLines(invoice);
  let document = emptyAmounts();
  for (const item of sortedItems(invoice.items)) {
    const line = standardInvoiceLineAmounts(
      invoice,
      billedByLineId,
      item,
      options,
    );
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

  if (creditNote.original_invoice.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
    const document = marginCreditNoteDocumentAmounts(creditNote);
    subtractFromMap(bySource, source, document);
    const primaryGroup = revenueGroupLabel(
      creditNote.items[0]?.original_invoice_item.revenue_group_name,
    );
    subtractFromMap(byGroup, primaryGroup, document);
    return;
  }

  let document = emptyAmounts();
  for (const item of creditNote.items) {
    const line = readCreditLineAmounts(item.snapshot) ?? emptyAmounts();
    document = addAmounts(document, line);
    subtractFromMap(
      byGroup,
      revenueGroupLabel(item.original_invoice_item.revenue_group_name),
      line,
    );
  }
  subtractFromMap(bySource, source, document);
}

function mapToSourceRows(
  bySource: Map<RevenueReportSource, RevenueReportAmounts>,
): RevenueReportCore['by_source'] {
  const order: RevenueReportSource[] = ['workshop', 'vehicle_sales', 'other'];
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
  options?: { legacyUndiscountedNet?: boolean };
}): RevenueReportCore {
  const bySource = new Map<RevenueReportSource, RevenueReportAmounts>();
  const byGroup = new Map<string, RevenueReportAmounts>();

  for (const invoice of input.invoices) {
    applyInvoice(invoice, bySource, byGroup, input.options);
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
    applyInvoice(invoice, bySource, byGroup, {
      legacyUndiscountedNet: true,
    });
  }
  return new Map(
    [...byGroup.entries()].map(([name, amounts]) => [name, amounts.net]),
  );
}
