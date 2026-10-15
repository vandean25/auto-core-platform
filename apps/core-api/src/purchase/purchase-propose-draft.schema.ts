import { z } from 'zod';

const uuidSchema = z.string().uuid();
const unitCostNetSchema = z
  .string()
  .regex(
    /^\d+\.\d{2}$/,
    'unit_cost_net must be a EUR decimal string with two places',
  );

export const purchaseCostBasisInputSchema = z
  .object({
    version: z.literal(1),
    unit_cost_net: unitCostNetSchema,
  })
  .strict();

export const proposePurchaseOrderLineInputSchema = z
  .object({
    reservation_id: uuidSchema,
    catalog_item_id: uuidSchema,
    cost_basis: purchaseCostBasisInputSchema,
  })
  .strict();

export const proposePurchaseOrderInputSchema = z
  .object({
    vendor_id: uuidSchema,
    requisition_id: uuidSchema,
    lines: z.array(proposePurchaseOrderLineInputSchema).min(1).max(25),
    command_id: uuidSchema
      .optional()
      .describe('Optional idempotency key for MCP write replay'),
  })
  .strict();

export type ProposePurchaseOrderInput = z.infer<
  typeof proposePurchaseOrderInputSchema
>;
