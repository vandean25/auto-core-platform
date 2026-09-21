import type { InvoiceSnapshot } from './invoice-snapshot.js';
import { isInvoiceSnapshotV2 } from './invoice-snapshot-v2.validation.js';

export function toRenderableInvoiceSnapshot(
  snapshot: unknown,
  invoiceNumber: string | null,
  invoiceId: string,
): InvoiceSnapshot | null {
  if (!isInvoiceSnapshotV2(snapshot)) {
    return null;
  }

  return {
    id: invoiceId,
    invoice_number: invoiceNumber,
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
    tax_breakdown: snapshot.tax_breakdown,
  };
}
