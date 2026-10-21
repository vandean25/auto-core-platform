import { z } from 'zod';

/**
 * Customer master-data proposal schemas for the MCP write tools (AUT-613).
 *
 * Both schemas are closed (`additionalProperties: false`): a consent field
 * such as `contact_email_ok` is not a writable customer field, so the schema
 * rejects it instead of storing it. Consent stays HUMAN_ONLY (AUT-589).
 */
export const customerProposeAddressSchema = z
  .object({
    street: z.string().trim().min(1).max(200).optional(),
    zip: z.string().trim().min(1).max(20).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    country: z
      .string()
      .trim()
      .length(2)
      .optional()
      .describe('ISO country code, for example AT'),
  })
  .strict();

export const customerProposeTypeSchema = z.enum(['PRIVATE', 'COMPANY']);

export const customerProposeLanguageSchema = z.enum(['de', 'en']);

export const customerProposeIdempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    'Caller key that identifies this proposal; a second call with the same key does not create a second proposal.',
  );

export const customerProposeCustomerIdSchema = z
  .string()
  .uuid()
  .describe('ID of the customer to change');

export const customerProposeReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .describe('Why the customer master data changes; shown to the approver');

/** The client idempotency key the MCP write tools share. */
export const optionalMcpCommandIdSchema = {
  command_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Client idempotency key for AUTO/PROPOSE writes. Replays return the same committed result or pending action.',
    ),
};

/** The customer fields a proposal may write. Every field is optional. */
export const customerProposeFieldsSchema = z
  .object({
    customer_type: customerProposeTypeSchema.optional(),
    first_name: z.string().trim().min(1).max(120).optional(),
    last_name: z.string().trim().min(1).max(120).optional(),
    company_name: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    vat_id: z.string().trim().min(1).max(32).optional(),
    address: customerProposeAddressSchema.optional(),
    preferred_language: customerProposeLanguageSchema.optional(),
  })
  .strict();

export const proposeCustomerCreateInputSchema = z
  .object({
    customer_type: customerProposeTypeSchema,
    first_name: z.string().trim().min(1).max(120),
    last_name: z.string().trim().min(1).max(120),
    company_name: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    vat_id: z.string().trim().min(1).max(32).optional(),
    address: customerProposeAddressSchema.optional(),
    preferred_language: customerProposeLanguageSchema.optional(),
    idempotency_key: customerProposeIdempotencyKeySchema,
    ...optionalMcpCommandIdSchema,
  })
  .strict();

export const proposeCustomerUpdateInputSchema = z
  .object({
    customer_id: customerProposeCustomerIdSchema,
    changes: customerProposeFieldsSchema,
    reason: customerProposeReasonSchema,
    idempotency_key: customerProposeIdempotencyKeySchema,
    ...optionalMcpCommandIdSchema,
  })
  .strict();

export type CustomerProposeAddress = z.infer<
  typeof customerProposeAddressSchema
>;
