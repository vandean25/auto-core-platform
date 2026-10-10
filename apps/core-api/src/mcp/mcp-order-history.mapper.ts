export type McpOrderKind = 'workshop_order' | 'sales_order';

export type McpOrderVehicle = {
  id: string;
  plate: string | null;
  make: string;
  model: string;
};

/** One order on a customer or vehicle history page, before the gross total is attached. */
export type McpOrderCandidate = {
  kind: McpOrderKind;
  id: string;
  orderNumber: string;
  status: string;
  createdAt: Date;
  vehicle: McpOrderVehicle | null;
};

/**
 * Compact order row. `total_gross` is the linked invoice's gross total, the same
 * figure list_invoices shows. An order that is not invoiced yet has no billed
 * total, so it is null rather than a figure computed from its lines.
 */
export function toMcpOrderRow(
  candidate: McpOrderCandidate,
  grossTotal: string | null,
) {
  return {
    id: candidate.id,
    kind: candidate.kind,
    number: candidate.orderNumber,
    status: candidate.status,
    vehicle: candidate.vehicle,
    date: candidate.createdAt.toISOString(),
    total_gross: grossTotal,
  };
}

type InspectionRecord = {
  id: string;
  inspection_type: string;
  inspected_on: Date;
  plaketten_valid_until_year: number;
  plaketten_valid_until_month: number;
  station_name: string | null;
};

/** One Pickerl inspection, with the sticker validity as YYYY-MM. */
export function toMcpInspectionRow(record: InspectionRecord) {
  return {
    id: record.id,
    inspection_type: record.inspection_type,
    inspected_on: record.inspected_on.toISOString().slice(0, 10),
    plaketten_valid_until: `${record.plaketten_valid_until_year}-${String(
      record.plaketten_valid_until_month,
    ).padStart(2, '0')}`,
    station_name: record.station_name,
  };
}
