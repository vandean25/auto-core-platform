import { z } from 'zod';

const uuidSchema = z.string().uuid();
const reportSiteIdSchema = uuidSchema
  .optional()
  .describe('Site for the report; defaults to the active site');

const isoWeekSchema = z
  .string()
  .regex(/^\d{4}-W\d{2}$/, 'iso_week must match YYYY-Www')
  .describe('ISO week label, for example 2026-W42 (Monday through Sunday)');

export const generateWeeklyReportPdfInputSchema = z
  .object({
    iso_week: isoWeekSchema.optional(),
    from: z
      .string()
      .date()
      .optional()
      .describe('Inclusive Monday, YYYY-MM-DD, in the site timezone'),
    to: z
      .string()
      .date()
      .optional()
      .describe('Inclusive Sunday, YYYY-MM-DD, in the site timezone'),
    site_id: reportSiteIdSchema,
    command_id: uuidSchema
      .optional()
      .describe(
        'Client idempotency key for AUTO writes. Replays return the same committed result.',
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasWeek = value.iso_week !== undefined;
    const hasFrom = value.from !== undefined;
    const hasTo = value.to !== undefined;
    if (hasWeek && (hasFrom || hasTo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide iso_week or from and to, not both',
        path: ['iso_week'],
      });
    }
    if (!hasWeek && (!hasFrom || !hasTo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide iso_week or both from and to',
      });
    }
  });
