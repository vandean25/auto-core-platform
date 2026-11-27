import { InvoiceTaxMode, Prisma } from '@prisma/client';
import type { InvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.js';
import {
  halfUpTax,
  INVOICE_SNAPSHOT_COUNTRY_PROFILE_VERSION,
  INVOICE_SNAPSHOT_SCHEMA_VERSION,
  INVOICE_SNAPSHOT_TEMPLATE_VERSION,
  type InvoiceSnapshotV2TaxBucket,
} from '../invoices/invoice-snapshot-v2.js';
import type { OriginalLineSnapshot } from './credit-note-allocation.js';
import {
  buildDocumentSnapshotLocaleFields,
  readDocumentSnapshotLocaleFields,
} from '../common/i18n/document-snapshot-locale.js';
import { resolveDocumentLanguage } from '../common/i18n/locale-resolution.js';
import {
  calendarDateInTimeZone,
  DEFAULT_INVOICE_TIME_ZONE,
} from '../sales/helpers/invoice-number.helpers.js';

export type CreditNoteSnapshotV2 = Omit<InvoiceSnapshotV2, 'document_kind'> & {
  document_kind: 'CREDIT_NOTE';
  credit_title: 'Stornorechnung' | 'Rechnungskorrektur';
  original_document: {
    id: string;
    number: string;
    date: string;
    reason: string;
    snapshot_version: number;
  };
};

export type CreditNoteLineSnapshot = {
  original_item_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  line_discount_type: string | null;
  line_discount_value: string | null;
  net: string;
  tax: string;
  gross: string;
  tax_rate: string;
  revenue_group_name: string | null;
  accounting_allocation: unknown;
};

const moneyString = (value: Prisma.Decimal): string => value.toFixed(2);
const quantityString = (value: Prisma.Decimal): string => value.toFixed(3);

export function extractOriginalLineSnapshots(
  snapshot: InvoiceSnapshotV2,
): OriginalLineSnapshot[] {
  return snapshot.items.map((item) => ({
    id: item.id,
    quantity: new Prisma.Decimal(item.quantity),
    net: new Prisma.Decimal(item.net),
    tax: new Prisma.Decimal(item.tax),
    gross: new Prisma.Decimal(item.gross),
  }));
}

type CreditTaxLine = Pick<
  CreditNoteLineSnapshot,
  'tax_rate' | 'net' | 'tax' | 'gross'
>;

type CreditTaxSummary = {
  totalNet: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalGross: Prisma.Decimal;
  taxBreakdown: InvoiceSnapshotV2TaxBucket[];
};

function sumLegacyCreditLines(
  lineSnapshots: readonly CreditTaxLine[],
): CreditTaxSummary {
  const taxBuckets = new Map<string, InvoiceSnapshotV2TaxBucket>();
  for (const line of lineSnapshots) {
    const existing = taxBuckets.get(line.tax_rate) ?? {
      rate: line.tax_rate,
      net: '0.00',
      tax: '0.00',
      gross: '0.00',
    };
    taxBuckets.set(line.tax_rate, {
      rate: line.tax_rate,
      net: moneyString(
        new Prisma.Decimal(existing.net).add(new Prisma.Decimal(line.net)),
      ),
      tax: moneyString(
        new Prisma.Decimal(existing.tax).add(new Prisma.Decimal(line.tax)),
      ),
      gross: moneyString(
        new Prisma.Decimal(existing.gross).add(new Prisma.Decimal(line.gross)),
      ),
    });
  }
  const taxBreakdown = [...taxBuckets.values()];
  const totalNet = lineSnapshots.reduce(
    (sum, line) => sum.add(new Prisma.Decimal(line.net)),
    new Prisma.Decimal(0),
  );
  const totalTax = lineSnapshots.reduce(
    (sum, line) => sum.add(new Prisma.Decimal(line.tax)),
    new Prisma.Decimal(0),
  );
  const totalGross = lineSnapshots.reduce(
    (sum, line) => sum.add(new Prisma.Decimal(line.gross)),
    new Prisma.Decimal(0),
  );
  return { totalNet, totalTax, totalGross, taxBreakdown };
}

export function computeCreditNoteTaxSummary(input: {
  originalSnapshot: InvoiceSnapshotV2;
  lineSnapshots: readonly CreditTaxLine[];
  isFullCredit: boolean;
  priorCreditTaxBuckets?: readonly InvoiceSnapshotV2TaxBucket[];
}): CreditTaxSummary {
  if (isMarginSchemeSnapshot(input.originalSnapshot)) {
    const totalNet = input.lineSnapshots.reduce(
      (sum, line) => sum.add(new Prisma.Decimal(line.net)),
      new Prisma.Decimal(0),
    );
    const totalGross = input.lineSnapshots.reduce(
      (sum, line) => sum.add(new Prisma.Decimal(line.gross)),
      new Prisma.Decimal(0),
    );
    return {
      totalNet,
      totalTax: new Prisma.Decimal(0),
      totalGross,
      taxBreakdown: [],
    };
  }

  if (input.lineSnapshots.length === 0) {
    return {
      totalNet: new Prisma.Decimal(0),
      totalTax: new Prisma.Decimal(0),
      totalGross: new Prisma.Decimal(0),
      taxBreakdown: [],
    };
  }

  if (input.originalSnapshot.vat_calculation !== 'PER_RATE') {
    return sumLegacyCreditLines(input.lineSnapshots);
  }

  const priorTaxByRate = new Map<string, Prisma.Decimal>();
  const priorNetByRate = new Map<string, Prisma.Decimal>();
  for (const bucket of input.priorCreditTaxBuckets ?? []) {
    const rate = moneyString(new Prisma.Decimal(bucket.rate));
    priorTaxByRate.set(
      rate,
      (priorTaxByRate.get(rate) ?? new Prisma.Decimal(0)).add(
        new Prisma.Decimal(bucket.tax),
      ),
    );
    priorNetByRate.set(
      rate,
      (priorNetByRate.get(rate) ?? new Prisma.Decimal(0)).add(
        new Prisma.Decimal(bucket.net),
      ),
    );
  }

  const originalNetByRate = new Map<string, Prisma.Decimal>();
  const remainingTaxByRate = new Map<string, Prisma.Decimal>();
  for (const bucket of input.originalSnapshot.tax_breakdown) {
    const rate = moneyString(new Prisma.Decimal(bucket.rate));
    originalNetByRate.set(rate, new Prisma.Decimal(bucket.net));
    const remaining = new Prisma.Decimal(bucket.tax).sub(
      priorTaxByRate.get(rate) ?? new Prisma.Decimal(0),
    );
    remainingTaxByRate.set(
      rate,
      Prisma.Decimal.max(remaining, new Prisma.Decimal(0)),
    );
  }

  const netByRate = new Map<string, Prisma.Decimal>();
  for (const line of input.lineSnapshots) {
    const rate = moneyString(new Prisma.Decimal(line.tax_rate));
    netByRate.set(
      rate,
      (netByRate.get(rate) ?? new Prisma.Decimal(0)).add(
        new Prisma.Decimal(line.net),
      ),
    );
  }

  const taxBreakdown: InvoiceSnapshotV2TaxBucket[] = [...netByRate.entries()]
    .sort(([left], [right]) =>
      new Prisma.Decimal(left).comparedTo(new Prisma.Decimal(right)),
    )
    .map(([rate, net]) => {
      const remainingTax = remainingTaxByRate.get(rate);
      const originalNet = originalNetByRate.get(rate);
      const priorNet = priorNetByRate.get(rate) ?? new Prisma.Decimal(0);
      const isRateFullyCredited =
        originalNet !== undefined && net.add(priorNet).eq(originalNet);
      const tax =
        (input.isFullCredit || isRateFullyCredited) &&
        remainingTax !== undefined
          ? remainingTax
          : remainingTax !== undefined
            ? Prisma.Decimal.min(
                halfUpTax(net, new Prisma.Decimal(rate)),
                remainingTax,
              )
            : halfUpTax(net, new Prisma.Decimal(rate));
      return {
        rate,
        net: moneyString(net),
        tax: moneyString(tax),
        gross: moneyString(net.add(tax)),
      };
    });

  const totalNet = taxBreakdown.reduce(
    (sum, bucket) => sum.add(new Prisma.Decimal(bucket.net)),
    new Prisma.Decimal(0),
  );
  const totalTax = taxBreakdown.reduce(
    (sum, bucket) => sum.add(new Prisma.Decimal(bucket.tax)),
    new Prisma.Decimal(0),
  );
  return {
    totalNet,
    totalTax,
    totalGross: totalNet
      .add(totalTax)
      .add(
        input.isFullCredit ? (input.originalSnapshot.rounding_amount ?? 0) : 0,
      ),
    taxBreakdown,
  };
}

export function buildCreditNoteSnapshot(input: {
  originalSnapshot: InvoiceSnapshotV2;
  originalInvoiceId: string;
  originalInvoiceNumber: string;
  originalInvoiceDate: Date;
  reason: string;
  creditDate: Date;
  isFullCredit: boolean;
  lineSnapshots: CreditNoteLineSnapshot[];
  committedAt: Date;
  timeZone?: string;
  priorCreditTaxBuckets?: readonly InvoiceSnapshotV2TaxBucket[];
}): CreditNoteSnapshotV2 {
  const timeZone = input.timeZone ?? DEFAULT_INVOICE_TIME_ZONE;
  const { totalNet, totalTax, totalGross, taxBreakdown } =
    computeCreditNoteTaxSummary({
      originalSnapshot: input.originalSnapshot,
      lineSnapshots: input.lineSnapshots,
      isFullCredit: input.isFullCredit,
      priorCreditTaxBuckets: input.priorCreditTaxBuckets,
    });

  const seller = input.originalSnapshot.seller;
  const inheritedLocale =
    readDocumentSnapshotLocaleFields(input.originalSnapshot) ??
    buildDocumentSnapshotLocaleFields(
      resolveDocumentLanguage(input.originalSnapshot),
    );

  return {
    ...inheritedLocale,
    schema_version: INVOICE_SNAPSHOT_SCHEMA_VERSION,
    document_kind: 'CREDIT_NOTE',
    credit_title: input.isFullCredit ? 'Stornorechnung' : 'Rechnungskorrektur',
    template_version: INVOICE_SNAPSHOT_TEMPLATE_VERSION,
    country_profile_version: INVOICE_SNAPSHOT_COUNTRY_PROFILE_VERSION,
    site_id: input.originalSnapshot.site_id,
    legal_entity_id: input.originalSnapshot.legal_entity_id,
    currency: 'EUR',
    seller,
    customer: input.originalSnapshot.customer,
    vehicle: input.originalSnapshot.vehicle,
    date: calendarDateInTimeZone(input.creditDate, timeZone),
    due_date: calendarDateInTimeZone(input.creditDate, timeZone),
    supply_date_from: input.originalSnapshot.supply_date_from,
    supply_date_to: input.originalSnapshot.supply_date_to,
    payment_terms: input.originalSnapshot.payment_terms,
    items: input.lineSnapshots.map((line) => ({
      id: line.original_item_id,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      tax_rate: line.tax_rate,
      line_discount_type: line.line_discount_type,
      line_discount_value: line.line_discount_value,
      net: line.net,
      tax: line.tax,
      gross: line.gross,
      revenue_group_name: line.revenue_group_name,
      accounting_allocation: line.accounting_allocation as never,
    })),
    // Margin-scheme documents carry no VAT buckets, mirroring the original snapshot (ADR-0023).
    tax_breakdown: taxBreakdown,
    ...(input.isFullCredit && input.originalSnapshot.rounding_amount
      ? { rounding_amount: input.originalSnapshot.rounding_amount }
      : {}),
    ...(input.originalSnapshot.margin
      ? { margin: input.originalSnapshot.margin }
      : {}),
    total_net: moneyString(totalNet),
    total_tax: moneyString(totalTax),
    total_gross: moneyString(totalGross),
    notes: null,
    tax_mode: input.originalSnapshot.tax_mode,
    snapshot_created_at: input.committedAt.toISOString(),
    original_document: {
      id: input.originalInvoiceId,
      number: input.originalInvoiceNumber,
      date: input.originalSnapshot.date,
      reason: input.reason,
      snapshot_version: input.originalSnapshot.schema_version,
    },
  };
}

export function buildCreditNoteLineSnapshot(input: {
  originalItemId: string;
  originalSnapshotItem: InvoiceSnapshotV2['items'][number];
  quantity: Prisma.Decimal;
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  gross: Prisma.Decimal;
}): CreditNoteLineSnapshot {
  return {
    original_item_id: input.originalItemId,
    description: input.originalSnapshotItem.description,
    quantity: quantityString(input.quantity),
    unit_price: input.originalSnapshotItem.unit_price,
    line_discount_type: input.originalSnapshotItem.line_discount_type,
    line_discount_value: input.originalSnapshotItem.line_discount_value,
    net: moneyString(input.net),
    tax: moneyString(input.tax),
    gross: moneyString(input.gross),
    tax_rate: input.originalSnapshotItem.tax_rate,
    revenue_group_name: input.originalSnapshotItem.revenue_group_name,
    accounting_allocation: input.originalSnapshotItem.accounting_allocation,
  };
}

export function isMarginSchemeSnapshot(snapshot: InvoiceSnapshotV2): boolean {
  return snapshot.tax_mode === InvoiceTaxMode.MARGIN_SCHEME;
}
