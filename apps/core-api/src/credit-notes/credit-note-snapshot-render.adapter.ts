import type { CreditNoteSnapshotV2 } from './credit-note-snapshot.js';
import type { InvoiceSnapshot } from '../invoices/invoice-snapshot.js';

function isCreditNoteSnapshotV2(value: unknown): value is CreditNoteSnapshotV2 {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.schema_version === 2 &&
    record.document_kind === 'CREDIT_NOTE' &&
    typeof record.credit_title === 'string' &&
    typeof record.original_document === 'object' &&
    record.original_document !== null
  );
}

export function toRenderableCreditNoteSnapshot(
  snapshot: unknown,
  creditNumber: string | null,
  creditNoteId: string,
): InvoiceSnapshot | null {
  if (!isCreditNoteSnapshotV2(snapshot)) {
    return null;
  }

  return {
    id: creditNoteId,
    invoice_number: creditNumber,
    date: `${snapshot.date}T00:00:00.000Z`,
    due_date: `${snapshot.due_date}T00:00:00.000Z`,
    total_net: snapshot.total_net,
    total_tax: snapshot.total_tax,
    total_gross: snapshot.total_gross,
    notes: snapshot.notes,
    tax_mode: snapshot.tax_mode,
    customer: snapshot.customer,
    vehicle: snapshot.vehicle,
    items: snapshot.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate,
      line_discount_type: item.line_discount_type,
      line_discount_value: item.line_discount_value,
      line_total: item.gross,
      revenue_group_name: item.revenue_group_name,
    })),
    snapshot_created_at: snapshot.snapshot_created_at,
    schema_version: 2,
    seller: snapshot.seller,
    supply_date_from: snapshot.supply_date_from,
    supply_date_to: snapshot.supply_date_to,
    payment_terms: snapshot.payment_terms,
    currency: snapshot.currency,
    ...(snapshot.tax_mode === 'MARGIN_SCHEME'
      ? {}
      : { tax_breakdown: snapshot.tax_breakdown }),
    document_kind: 'CREDIT_NOTE',
    credit_title: snapshot.credit_title,
    original_document: snapshot.original_document,
  };
}
