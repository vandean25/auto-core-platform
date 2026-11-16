import { z } from 'zod';
import { optionalMcpCommandIdSchema } from '../customer/customer-propose.schema.js';

/**
 * Vehicle master-data proposal schemas for the MCP write tools (AUT-614).
 *
 * Both schemas are closed (`strict()`): fields owned by other flows
 * (stock/sales fields such as inventory_role, stock_status, tax_scheme,
 * purchase/sale, listing data, valuation, inspection records) are rejected.
 */
export const vehicleProposeIdempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    'Caller key that identifies this proposal; a second call with the same key does not create a second proposal.',
  );

export const vehicleProposeVehicleIdSchema = z
  .string()
  .uuid()
  .describe('ID of the vehicle to change');

export const vehicleProposeReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .describe(
    'Why the vehicle master data changes (required when decreasing mileage); shown to the approver',
  );

export const vehicleProposeChangesSchema = z
  .object({
    owner_customer_id: z.string().uuid().nullable().optional(),
    vin: z.string().trim().min(1).max(32).nullable().optional(),
    plate: z.string().trim().min(1).max(32).nullable().optional(),
    make: z.string().trim().min(1).max(120).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    variant: z.string().trim().min(1).max(120).nullable().optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    first_registration_date: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .nullable()
      .optional(),
    mileage_km: z.number().int().min(0).max(5_000_000).nullable().optional(),
    fuel_type: z.string().trim().min(1).max(60).nullable().optional(),
    national_code: z.string().trim().min(1).max(16).nullable().optional(),
  })
  .strict();

export const proposeVehicleCreateInputSchema = z
  .object({
    owner_customer_id: z.string().uuid().optional(),
    vin: z.string().trim().min(1).max(32).optional(),
    plate: z.string().trim().min(1).max(32).optional(),
    make: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    variant: z.string().trim().min(1).max(120).optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    first_registration_date: z.string().trim().min(1).max(40).optional(),
    mileage_km: z.number().int().min(0).max(5_000_000).optional(),
    fuel_type: z.string().trim().min(1).max(60).optional(),
    national_code: z.string().trim().min(1).max(16).optional(),
    idempotency_key: vehicleProposeIdempotencyKeySchema,
    ...optionalMcpCommandIdSchema,
  })
  .strict();

export const proposeVehicleUpdateInputSchema = z
  .object({
    vehicle_id: vehicleProposeVehicleIdSchema,
    changes: vehicleProposeChangesSchema,
    reason: vehicleProposeReasonSchema.optional(),
    idempotency_key: vehicleProposeIdempotencyKeySchema,
    ...optionalMcpCommandIdSchema,
  })
  .strict();
