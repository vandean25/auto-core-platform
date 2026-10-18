import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  TyreSeason,
  TyreSetStatus,
  WarrantyClaimStatus,
  WarrantyClaimType,
} from '@prisma/client';
import { z } from 'zod';
import { MCP_TOOL_NAMES_WITH_COMPLIANCE } from './mcp-read-tool-catalog.aut605.js';
import type { McpComplianceReadToolName } from './mcp-read-tool-catalog.aut605.js';
import {
  mcpOutputCount,
  mcpOutputDecimalString,
  mcpOutputIdString,
  mcpOutputIsoDateOnly,
  mcpOutputIsoDateTime,
  mcpOutputNonEmptyString,
  mcpOutputNullableDecimalString,
  mcpOutputNullableIsoDateTime,
  mcpOutputResultOf,
  mcpOutputTotalCursorMeta,
} from './mcp-tool-output-schema.util.js';

const capabilityRow = z.object({
  tool: z.enum(MCP_TOOL_NAMES_WITH_COMPLIANCE),
  description: z.string(),
  tier: z.enum(['AUTO', 'PROPOSE']),
  access: z.enum(['read', 'write']),
  enabled: z.boolean(),
  disabled_reason: z.enum(['policy_disabled', 'role_not_permitted']).optional(),
});

export const getCapabilitiesOutputSchemaWithCompliance = mcpOutputResultOf({
  data: z.array(capabilityRow),
  meta: mcpOutputTotalCursorMeta,
  human_only_actions: z.array(z.string()),
});

export const mcpComplianceReadOutputSchemas: Record<
  McpComplianceReadToolName,
  z.ZodTypeAny
> = {
  check_contact_permission: mcpOutputResultOf({
    customer_id: mcpOutputIdString,
    purpose: z.nativeEnum(CustomerConsentPurpose),
    channel: z.nativeEnum(CustomerConsentChannel),
    allowed: z.boolean(),
    reason: z.enum([
      'ALLOWED',
      'MARKETING_PERMISSION_MISSING',
      'CONTACT_WITHDRAWN',
      'PROCESSING_RESTRICTED',
      'NO_CONTACT_POINT',
      'SOFT_OPT_IN_INCOMPLETE',
    ]),
  }),
  list_gewaehrleistung_due: mcpOutputResultOf({
    within_days: z.union([z.literal(30), z.literal(60), z.literal(90)]),
    data: z.array(
      z.object({
        id: mcpOutputIdString,
        sale_number: mcpOutputNonEmptyString,
        vehicle_id: mcpOutputIdString,
        customer_id: mcpOutputIdString,
        handed_over_at: mcpOutputIsoDateOnly.nullable(),
        gewaehrleistung_ends_on: mcpOutputIsoDateOnly.nullable(),
        presumption_ends_on: mcpOutputIsoDateOnly.nullable(),
        gewaehrleistung_rule_version: z.string().nullable(),
        vehicle: z.object({
          id: mcpOutputIdString,
          make: mcpOutputNonEmptyString,
          model: mcpOutputNonEmptyString,
          year: z.number().int(),
          vin: z.string().nullable(),
          plate: z.string().nullable(),
        }),
        customer_name: z.string().nullable(),
      }),
    ),
    meta: mcpOutputTotalCursorMeta,
  }),
  list_tyre_sets: mcpOutputResultOf({
    data: z.array(
      z.object({
        id: mcpOutputIdString,
        customer_id: mcpOutputIdString,
        vehicle_id: mcpOutputIdString.nullable(),
        site_id: mcpOutputIdString,
        location_id: mcpOutputIdString.nullable(),
        location_code: z.string().nullable(),
        label: mcpOutputNonEmptyString,
        season: z.nativeEnum(TyreSeason),
        tyre_count: z.number().int(),
        rim_type: z.string().nullable(),
        brand: z.string().nullable(),
        model: z.string().nullable(),
        dimension: z.string().nullable(),
        status: z.nativeEnum(TyreSetStatus),
        stored_since: mcpOutputIsoDateOnly.nullable(),
        planned_swap_on: mcpOutputIsoDateOnly.nullable(),
        bin_label: z.string().nullable(),
        customer_name: z.string().nullable(),
        customer_phone: z.string().nullable(),
        customer_email: z.string().nullable(),
        vehicle_plate: z.string().nullable(),
      }),
    ),
    meta: mcpOutputTotalCursorMeta,
  }),
  list_warranty_claims: mcpOutputResultOf({
    data: z.array(
      z.object({
        id: mcpOutputIdString,
        workshop_order_id: mcpOutputIdString,
        type: z.nativeEnum(WarrantyClaimType),
        status: z.nativeEnum(WarrantyClaimStatus),
        claimed_amount_net: mcpOutputNullableDecimalString,
        lines_net_amount: mcpOutputDecimalString,
        external_reference: z.string().nullable(),
        decision_date: mcpOutputIsoDateOnly.nullable(),
        submitted_at: mcpOutputNullableIsoDateTime,
        closed_at: mcpOutputNullableIsoDateTime,
        created_at: mcpOutputIsoDateTime,
        updated_at: mcpOutputIsoDateTime,
        line_count: mcpOutputCount,
      }),
    ),
    meta: mcpOutputTotalCursorMeta,
  }),
};
