import { z } from 'zod';

const uuidSchema = z.string().uuid();

const optionalMcpCommandIdSchema = {
  command_id: uuidSchema
    .optional()
    .describe(
      'Client idempotency key for AUTO/PROPOSE writes. Replays return the same committed result or pending action.',
    ),
};

export const proposeInvoiceDraftFromOrderInputSchema = z
  .object({
    workshop_order_id: uuidSchema,
    /** Set by the server during PROPOSE enrichment; apply uses this order id. */
    pinned_workshop_order_id: uuidSchema.optional(),
    /** Digest of billable workshop lines at propose time; apply conflicts when lines changed. */
    pinned_billable_digest: z.string().min(1).max(128).optional(),
    ...optionalMcpCommandIdSchema,
  })
  .strict();

export type ProposeInvoiceDraftFromOrderInput = z.infer<
  typeof proposeInvoiceDraftFromOrderInputSchema
>;
