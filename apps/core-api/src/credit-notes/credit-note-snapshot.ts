import { InvoiceTaxMode, Prisma } from '@prisma/client';
import type { InvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.js';
import {
  INVOICE_SNAPSHOT_COUNTRY_PROFILE_VERSION,
  INVOICE_SNAPSHOT_SCHEMA_VERSION,
  INVOICE_SNAPSHOT_TEMPLATE_VERSION,
} from '../invoices/invoice-snapshot-v2.js';
import type { OriginalLineSnapshot } from './credit-note-allocation.js';

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
}): CreditNoteSnapshotV2 {
  const totalNet = input.lineSnapshots.reduce(
    (sum, line) => sum.add(new Prisma.Decimal(line.net)),
    new Prisma.Decimal(0),
  );
  const totalTax = input.lineSnapshots.reduce(
    (sum, line) => sum.add(new Prisma.Decimal(line.tax)),
    new Prisma.Decimal(0),
  );
  const totalGross = input.lineSnapshots.reduce(
    (sum, line) => sum.add(new Prisma.Decimal(line.gross)),
    new Prisma.Decimal(0),
  );

  const taxBuckets = new Map<
    string,
    { rate: string; net: string; tax: string; gross: string }
  >();
  for (const line of input.lineSnapshots) {
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

  const seller = input.originalSnapshot.seller;

  return {
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
    date: input.creditDate.toISOString().slice(0, 10),
    due_date: input.creditDate.toISOString().slice(0, 10),
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
    tax_breakdown: [...taxBuckets.values()],
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
      date: input.originalInvoiceDate.toISOString().slice(0, 10),
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
