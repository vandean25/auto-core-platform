import { z } from 'zod';

const uuidSchema = z.string().uuid();

const optionalMcpCommandIdSchema = {
  command_id: uuidSchema
    .optional()
    .describe(
      'Client idempotency key for AUTO/PROPOSE writes. Replays return the same committed result or pending action.',
    ),
};

const proposedFindingLineItemSchema = z
  .object({
    type: z.enum(['PART', 'LABOR']),
    item_no: z.string().min(1),
    description: z.string().min(1),
    quantity: z.number().min(0.001),
    unit_price_cents: z.number().int().min(0),
    labor_operation_id: uuidSchema.optional(),
  })
  .strict()
  .superRefine((line, ctx) => {
    if (line.type === 'PART' && line.labor_operation_id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PART lines cannot reference labor_operation_id',
      });
    }
  });

export const proposeMechanicFindingInputSchema = z
  .object({
    workshop_order_id: uuidSchema,
    workshop_task_id: uuidSchema,
    description: z.string().min(1).max(8000),
    media_ids: z.array(uuidSchema).max(20).default([]),
    proposed_line_items: z
      .array(proposedFindingLineItemSchema)
      .max(10)
      .optional(),
    /** Set by the server during PROPOSE enrichment. */
    pinned_media_ids: z.array(uuidSchema).max(20).optional(),
    pinned_line_items_version: z.number().int().min(0).optional(),
    pinned_proposed_line_items: z
      .array(proposedFindingLineItemSchema)
      .max(10)
      .optional(),
    ...optionalMcpCommandIdSchema,
  })
  .strict();

export type ProposeMechanicFindingInput = z.infer<
  typeof proposeMechanicFindingInputSchema
>;

export const requestWorkshopMediaUploadInputSchema = z
  .object({
    workshop_task_id: uuidSchema,
    mime_type: z.enum(['image/jpeg', 'image/png', 'image/heic', 'image/webp']),
    size_bytes: z.number().int().min(1),
    purpose: z.enum(['MECHANIC_FINDING', 'CHECK_IN']),
    ...optionalMcpCommandIdSchema,
  })
  .strict();

export type RequestWorkshopMediaUploadInput = z.infer<
  typeof requestWorkshopMediaUploadInputSchema
>;
