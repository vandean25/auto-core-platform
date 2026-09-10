import type { InvoiceSnapshot } from './invoice-snapshot';

const isString = (value: unknown): value is string => typeof value === 'string';

const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isCustomerType = (value: unknown): value is 'PRIVATE' | 'COMPANY' =>
  value === 'PRIVATE' || value === 'COMPANY';

const isTaxMode = (value: unknown): value is 'STANDARD' | 'MARGIN_SCHEME' =>
  value === 'STANDARD' || value === 'MARGIN_SCHEME';

const isInvoiceSnapshotCustomer = (
  value: unknown,
): value is InvoiceSnapshot['customer'] => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isCustomerType(value.type) &&
    isNullableString(value.company_name) &&
    isString(value.first_name) &&
    isString(value.last_name) &&
    isNullableString(value.email) &&
    isNullableString(value.phone) &&
    isNullableString(value.vat_id) &&
    isNullableString(value.address_street) &&
    isNullableString(value.address_city) &&
    isNullableString(value.address_zip) &&
    isNullableString(value.address_country)
  );
};

const isInvoiceSnapshotVehicle = (
  value: unknown,
): value is InvoiceSnapshot['vehicle'] => {
  if (value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.make) &&
    isString(value.model) &&
    typeof value.year === 'number' &&
    isNullableString(value.engine_code) &&
    isNullableString(value.vin) &&
    isNullableString(value.plate)
  );
};

const isInvoiceSnapshotItem = (
  value: unknown,
): value is InvoiceSnapshot['items'][number] => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.description) &&
    isString(value.quantity) &&
    isString(value.unit_price) &&
    isString(value.tax_rate) &&
    isNullableString(value.line_discount_type) &&
    isNullableString(value.line_discount_value) &&
    isNullableString(value.line_total) &&
    isNullableString(value.revenue_group_name)
  );
};

const isInvoiceSnapshotItems = (
  value: unknown,
): value is InvoiceSnapshot['items'] =>
  Array.isArray(value) && value.every(isInvoiceSnapshotItem);

const hasValidInvoiceIdentifiers = (record: Record<string, unknown>): boolean =>
  isString(record.id) && isNullableString(record.invoice_number);

const hasValidInvoiceDatesAndNotes = (
  record: Record<string, unknown>,
): boolean =>
  isString(record.date) &&
  isString(record.due_date) &&
  isNullableString(record.notes);

const hasValidInvoiceTotals = (record: Record<string, unknown>): boolean =>
  isString(record.total_net) &&
  isString(record.total_tax) &&
  isString(record.total_gross);

const hasValidInvoiceRelations = (record: Record<string, unknown>): boolean =>
  isInvoiceSnapshotCustomer(record.customer) &&
  isInvoiceSnapshotVehicle(record.vehicle) &&
  isInvoiceSnapshotItems(record.items) &&
  isString(record.snapshot_created_at);

export const isInvoiceSnapshot = (value: unknown): value is InvoiceSnapshot => {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !hasValidInvoiceIdentifiers(value) ||
    !hasValidInvoiceDatesAndNotes(value) ||
    !hasValidInvoiceTotals(value)
  ) {
    return false;
  }

  if (value.tax_mode !== undefined && !isTaxMode(value.tax_mode)) {
    return false;
  }

  return hasValidInvoiceRelations(value);
};

export const parseInvoiceSnapshot = (value: unknown): InvoiceSnapshot | null =>
  isInvoiceSnapshot(value) ? value : null;
