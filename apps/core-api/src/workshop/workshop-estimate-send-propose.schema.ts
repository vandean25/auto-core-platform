import { z } from 'zod';

const uuidSchema = z.string().uuid();

const optionalMcpCommandIdSchema = {
  command_id: uuidSchema
    .optional()
    .describe(
      'Client idempotency key for AUTO/PROPOSE writes. Replays return the same committed result or pending action.',
    ),
};

export const proposeEstimateSendInputSchema = z
  .object({
    workshop_order_id: uuidSchema,
    estimate_version_id: uuidSchema.optional(),
    channel: z.literal('email'),
    valid_until: z.iso.datetime().optional(),
    /** Set by the server during PROPOSE enrichment. */
    pinned_workshop_order_id: uuidSchema.optional(),
    /** Digest of billable workshop lines at propose time. */
    pinned_lines_digest: z.string().min(1).max(128).optional(),
    /** Normalized recipient email at propose time. */
    pinned_recipient_email: z.string().min(1).max(320).optional(),
    /** When set, apply must send this existing draft version id. */
    pinned_draft_version_id: uuidSchema.optional(),
    pinned_needs_create_estimate: z.boolean().optional(),
    pinned_needs_revision: z.boolean().optional(),
    /** ISO instant for a custom validity end, when the caller set valid_until. */
    pinned_valid_until: z.iso.datetime().optional(),
    ...optionalMcpCommandIdSchema,
  })
  .strict();

export type ProposeEstimateSendInput = z.infer<
  typeof proposeEstimateSendInputSchema
>;
