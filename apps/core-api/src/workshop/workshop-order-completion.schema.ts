import { z } from 'zod';

const uuidSchema = z.string().uuid();

const optionalMcpCommandIdSchema = {
  command_id: uuidSchema
    .optional()
    .describe(
      'Client idempotency key for AUTO/PROPOSE writes. Replays return the same committed result or pending action.',
    ),
};

export const proposeWorkshopOrderCompletionInputSchema = z
  .object({
    workshop_order_id: uuidSchema,
    workshop_task_ids: z.array(uuidSchema).min(1).max(50).optional(),
    odometer_out: z.number().int().min(0).max(9_999_999).optional(),
    notes: z.string().max(4000).optional(),
    notify_customer: z.boolean().optional().default(false),
    ...optionalMcpCommandIdSchema,
  })
  .strict();

export type ProposeWorkshopOrderCompletionInput = z.infer<
  typeof proposeWorkshopOrderCompletionInputSchema
>;
