import type { InvoiceSnapshotV2 } from './invoice-snapshot-v2.js';

const isString = (value: unknown): value is string => typeof value === 'string';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const isInvoiceSnapshotV2 = (
  value: unknown,
): value is InvoiceSnapshotV2 => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.schema_version === 2 &&
    value.document_kind === 'INVOICE' &&
    isString(value.site_id) &&
    isString(value.legal_entity_id) &&
    value.currency === 'EUR' &&
    isRecord(value.seller) &&
    isString(value.seller.name) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    Array.isArray(value.tax_breakdown) &&
    isString(value.total_net) &&
    isString(value.total_tax) &&
    isString(value.total_gross) &&
    isString(value.snapshot_created_at)
  );
};
