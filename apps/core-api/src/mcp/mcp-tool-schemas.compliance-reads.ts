import {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  TyreSetStatus,
  WarrantyClaimStatus,
  WarrantyClaimType,
} from '@prisma/client';
import { z } from 'zod';
import { MCP_MAX_PAGE_SIZE } from './mcp.constants.js';
import type { McpComplianceReadToolName } from './mcp-read-tool-catalog.aut605.js';

const uuidSchema = z.string().uuid();

const pageSizeCamelSchema = z
  .number()
  .int()
  .min(1)
  .max(MCP_MAX_PAGE_SIZE)
  .optional();

const reportPageSizeSchema = z
  .number()
  .int()
  .min(1)
  .max(MCP_MAX_PAGE_SIZE)
  .optional()
  .describe('Page size (max 25)');

const offsetCursorSchema = z
  .string()
  .min(1)
  .describe('Opaque cursor from meta.next_cursor on the previous page');

const keysetCursorSchema = z
  .string()
  .min(1)
  .describe('Opaque cursor from meta.next_cursor on the previous page');

/** AUT-605: consent gate before outbound contact; returns allowed and reason only. */
export const checkContactPermissionInputSchema = z.object({
  customer_id: uuidSchema,
  purpose: z.nativeEnum(CustomerConsentPurpose),
  channel: z.nativeEnum(CustomerConsentChannel),
  controller_legal_entity_id: uuidSchema
    .optional()
    .describe(
      'Controller legal entity when the tenant has more than one active entity',
    ),
});

/** AUT-605 Gewährleistung due list for the active site (same query as REST gewaehrleistung-due). */
export const listGewaehrleistungDueInputSchema = z.object({
  within_days: z
    .union([z.literal(30), z.literal(60), z.literal(90)])
    .optional()
    .describe('Days until base Gewährleistung period ends; default 30'),
  pageSize: reportPageSizeSchema,
  cursor: offsetCursorSchema
    .optional()
    .describe('Cursor from meta.next_cursor'),
});

/** AUT-605 tyre storage sets at the active site. */
export const listTyreSetsInputSchema = z.object({
  customer_id: uuidSchema.optional(),
  vehicle_id: uuidSchema.optional(),
  status: z.nativeEnum(TyreSetStatus).optional(),
  due_for_swap: z
    .boolean()
    .optional()
    .describe('When true, list sets due for seasonal swap only'),
  pageSize: pageSizeCamelSchema,
  cursor: offsetCursorSchema.optional(),
});

/** AUT-605 warranty claims at the active site (optional order filter). */
export const listWarrantyClaimsInputSchema = z.object({
  status: z.nativeEnum(WarrantyClaimStatus).optional(),
  type: z.nativeEnum(WarrantyClaimType).optional(),
  order_id: uuidSchema.optional(),
  pageSize: pageSizeCamelSchema,
  cursor: keysetCursorSchema.optional(),
});

export const mcpComplianceReadInputSchemas: Record<
  McpComplianceReadToolName,
  z.ZodTypeAny
> = {
  check_contact_permission: checkContactPermissionInputSchema,
  list_gewaehrleistung_due: listGewaehrleistungDueInputSchema,
  list_tyre_sets: listTyreSetsInputSchema,
  list_warranty_claims: listWarrantyClaimsInputSchema,
};
