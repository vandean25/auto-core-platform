import type { TyreSetResponseDto } from '../tyre-storage/dto/tyre-set.dto.js';
import type { WarrantyClaimResponse } from '../warranty-claim/warranty-claim.mapper.js';
import { mcpCustomerName } from './mcp-invoice-read.mapper.js';
import type { McpKeysetCursor } from './mcp-output.util.js';

type GewaehrleistungDueRow = {
  id: string;
  sale_number: string;
  vehicle_id: string;
  customer_id: string;
  handed_over_at: Date | null;
  gewaehrleistung_ends_on: Date | null;
  presumption_ends_on: Date | null;
  gewaehrleistung_rule_version: string | null;
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    vin: string | null;
    plate: string | null;
  };
  customer: {
    type: 'COMPANY' | 'PRIVATE';
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
  };
};

export function toMcpGewaehrleistungDueRow(row: GewaehrleistungDueRow) {
  const customer = row.customer;
  return {
    id: row.id,
    sale_number: row.sale_number,
    vehicle_id: row.vehicle_id,
    customer_id: row.customer_id,
    handed_over_at: row.handed_over_at
      ? row.handed_over_at.toISOString().slice(0, 10)
      : null,
    gewaehrleistung_ends_on: row.gewaehrleistung_ends_on
      ? row.gewaehrleistung_ends_on.toISOString().slice(0, 10)
      : null,
    presumption_ends_on: row.presumption_ends_on
      ? row.presumption_ends_on.toISOString().slice(0, 10)
      : null,
    gewaehrleistung_rule_version: row.gewaehrleistung_rule_version,
    vehicle: {
      id: row.vehicle.id,
      make: row.vehicle.make,
      model: row.vehicle.model,
      year: row.vehicle.year,
      vin: row.vehicle.vin,
      plate: row.vehicle.plate,
    },
    customer_name: mcpCustomerName({
      type: customer.type,
      company_name: customer.company_name,
      first_name: customer.first_name ?? '',
      last_name: customer.last_name ?? '',
    }),
  };
}

export function toMcpTyreSetRow(row: TyreSetResponseDto) {
  return {
    id: row.id,
    customer_id: row.customerId,
    vehicle_id: row.vehicleId,
    site_id: row.siteId,
    location_id: row.locationId,
    location_code: row.locationCode,
    label: row.label,
    season: row.season,
    tyre_count: row.tyreCount,
    rim_type: row.rimType,
    brand: row.brand,
    model: row.model,
    dimension: row.dimension,
    status: row.status,
    stored_since: row.storedSince,
    planned_swap_on: row.plannedSwapOn,
    bin_label: row.binLabel,
    customer_name: row.customerName,
    customer_phone: row.customerPhone,
    customer_email: row.customerEmail,
    vehicle_plate: row.vehiclePlate,
  };
}

/** Compact claim row for agents: no complaint, cause, or decision note text. */
export function toMcpWarrantyClaimListRow(claim: WarrantyClaimResponse) {
  return {
    id: claim.id,
    workshop_order_id: claim.workshopOrderId,
    type: claim.type,
    status: claim.status,
    claimed_amount_net: claim.claimedAmountNet,
    lines_net_amount: claim.linesNetAmount,
    external_reference: claim.externalReference,
    decision_date: claim.decisionDate,
    submitted_at: claim.submittedAt,
    closed_at: claim.closedAt,
    created_at: claim.createdAt,
    updated_at: claim.updatedAt,
    line_count: claim.lines.length,
  };
}

export function warrantyClaimKeysetCursorOf(
  createdAtIso: string,
  id: string,
): McpKeysetCursor {
  return { at: createdAtIso, id };
}
