import type { GewaehrleistungRuleSet } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-rule-sets.js';
import { resolveGewaehrleistungRuleSet } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-rule-sets.js';
import { toMcpInspectionRow } from './mcp-order-history.mapper.js';
import { resolvePickerlRuleSet } from '../vehicle/pickerl/pickerl-rule-sets.js';
import {
  decodeMcpKeysetCursor,
  encodeMcpKeysetCursor,
  encodeMcpPositionCursor,
  type McpKeysetCursor,
} from './mcp-output.util.js';

/** Finite section allowlist for get_vehicle_context. */
export const MCP_VEHICLE_CONTEXT_SECTIONS = [
  'identity',
  'parties',
  'due_dates',
  'open_workshop',
  'inspections',
  'documents',
  'warranty_claims',
  'warranty_periods',
] as const;

export type McpVehicleContextSection =
  (typeof MCP_VEHICLE_CONTEXT_SECTIONS)[number];

export const MCP_VEHICLE_CONTEXT_PAGINATED_SECTIONS = [
  'open_workshop',
  'inspections',
  'documents',
  'warranty_claims',
  'warranty_periods',
] as const satisfies readonly McpVehicleContextSection[];

export type McpVehicleContextPaginatedSection =
  (typeof MCP_VEHICLE_CONTEXT_PAGINATED_SECTIONS)[number];

export const MCP_VEHICLE_CONTEXT_OPERATIONAL_SECTIONS = [
  'open_workshop',
  'documents',
  'warranty_claims',
  'warranty_periods',
] as const satisfies readonly McpVehicleContextSection[];

export const MCP_VEHICLE_CONTEXT_DISCLAIMER =
  'Context for workshop use only. Not a legal warranty commitment or tax decision.';

export type McpVehicleContextCursor = {
  section: McpVehicleContextPaginatedSection;
  keyset?: McpKeysetCursor;
};

export function encodeMcpVehicleContextCursor(
  cursor: McpVehicleContextCursor,
): string {
  return encodeMcpPositionCursor(cursor);
}

export function decodeMcpVehicleContextCursor(
  cursor: string,
): McpVehicleContextCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const { section, keyset } = parsed as Record<string, unknown>;
  if (
    typeof section !== 'string' ||
    !MCP_VEHICLE_CONTEXT_PAGINATED_SECTIONS.includes(
      section as McpVehicleContextPaginatedSection,
    )
  ) {
    return null;
  }
  if (keyset === undefined) {
    return { section: section as McpVehicleContextPaginatedSection };
  }
  if (!keyset || typeof keyset !== 'object') {
    return null;
  }
  const { at, id } = keyset as Record<string, unknown>;
  if (typeof at !== 'string' || typeof id !== 'string') {
    return null;
  }
  const decodedKeyset = decodeMcpKeysetCursor(
    encodeMcpKeysetCursor({ at, id }),
  );
  if (!decodedKeyset) {
    return null;
  }
  return {
    section: section as McpVehicleContextPaginatedSection,
    keyset: decodedKeyset,
  };
}

export function toMcpOpenWorkshopRow(order: {
  id: string;
  order_number: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: order.id,
    number: order.order_number,
    status: order.status,
    opened_at: order.createdAt.toISOString(),
    workshop_order_ref: order.id,
  };
}

export function toMcpWarrantyClaimContextRow(claim: {
  id: string;
  workshop_order_id: string;
  type: string;
  status: string;
  claimed_amount_net: { toFixed: (digits: number) => string } | null;
  external_reference: string | null;
  createdAt: Date;
}) {
  return {
    id: claim.id,
    workshop_order_id: claim.workshop_order_id,
    type: claim.type,
    status: claim.status,
    claimed_amount_net: claim.claimed_amount_net?.toFixed(2) ?? null,
    external_reference: claim.external_reference,
    created_at: claim.createdAt.toISOString(),
    workshop_order_ref: claim.workshop_order_id,
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

export function toMcpVehicleContextInspectionRow(
  record: InspectionRecord,
  onDate: Date,
) {
  const ruleSet = resolvePickerlRuleSet(onDate);
  return {
    ...toMcpInspectionRow(record),
    value_source: {
      table: 'vehicle_inspection_record',
      resolved_pickerl_rule_id: ruleSet.id,
    },
    limits: {
      includes_notes: false,
      sticker_validity_is_month_granularity: true,
      interval_years: [...ruleSet.intervalYears],
      tolerance_months_before: ruleSet.tolerance.monthsBefore,
      tolerance_months_after: ruleSet.tolerance.monthsAfter,
    },
  };
}

export function gewaehrleistungRuleLimits(
  ruleSet: GewaehrleistungRuleSet | null,
) {
  if (!ruleSet) {
    return null;
  }
  return {
    base_period_years: ruleSet.basePeriodYears,
    shortened_period_years: ruleSet.shortenedPeriodYears,
    presumption_period_years: ruleSet.presumptionPeriodYears,
    minimum_vehicle_age_years: ruleSet.minimumVehicleAgeYears,
    scope_note: ruleSet.scopeNote,
  };
}

export function toMcpWarrantyPeriodRow(
  sale: {
    id: string;
    sale_number: string;
    contract_concluded_at: Date | null;
    handed_over_at: Date | null;
    gewaehrleistung_ends_on: Date | null;
    presumption_ends_on: Date | null;
    gewaehrleistung_rule_version: string | null;
    gewaehrleistung_shortened_negotiated: boolean | null;
    buyer_is_consumer: boolean | null;
    createdAt: Date;
  },
  readFields: {
    gewaehrleistung_status: string | null;
    gewaehrleistung_ends_on_expired: boolean;
    presumption_ends_on_expired: boolean;
  },
) {
  const ruleSet =
    sale.contract_concluded_at === null
      ? null
      : resolveGewaehrleistungRuleSet(sale.contract_concluded_at);
  return {
    vehicle_sale_id: sale.id,
    sale_number: sale.sale_number,
    contract_concluded_on: sale.contract_concluded_at
      ? sale.contract_concluded_at.toISOString().slice(0, 10)
      : null,
    handed_over_on: sale.handed_over_at
      ? sale.handed_over_at.toISOString().slice(0, 10)
      : null,
    gewaehrleistung_status: readFields.gewaehrleistung_status,
    gewaehrleistung_ends_on: sale.gewaehrleistung_ends_on
      ? sale.gewaehrleistung_ends_on.toISOString().slice(0, 10)
      : null,
    presumption_ends_on: sale.presumption_ends_on
      ? sale.presumption_ends_on.toISOString().slice(0, 10)
      : null,
    gewaehrleistung_ends_on_expired: readFields.gewaehrleistung_ends_on_expired,
    presumption_ends_on_expired: readFields.presumption_ends_on_expired,
    shortened_negotiated: sale.gewaehrleistung_shortened_negotiated ?? false,
    buyer_is_consumer: sale.buyer_is_consumer,
    value_source: {
      persisted_rule_version: sale.gewaehrleistung_rule_version,
      resolved_rule_set_id: ruleSet?.id ?? null,
    },
    limits: gewaehrleistungRuleLimits(ruleSet),
    document_ref: `vehicle_sale_contract:${sale.id}`,
    created_at: sale.createdAt.toISOString(),
  };
}
