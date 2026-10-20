import { z } from 'zod';
import type { McpWriteToolName } from './mcp.constants.js';
import { mergeMcpWriteToolOutput } from './mcp-write-dry-run.schema.js';

const idString = z.string().min(1);
const nonEmptyString = z.string().min(1);
const count = z.number().int().min(0);

const truncatedMarkerShape = {
  __truncated__: z.literal(true),
  originalBytes: count,
  preview: z.string(),
};

type Shape = Record<string, z.ZodType>;

function optionalShape<S extends Shape>(shape: S) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, schema.optional()]),
  ) as { [K in keyof S]: z.ZodOptional<S[K]> };
}

const wouldChangeItem = z.object({
  entity: nonEmptyString,
  id: idString,
  op: z.enum(['create', 'update', 'delete']),
  provisional: z.boolean(),
});

const writeProposal = z.object({
  payload: z.record(z.string(), z.unknown()),
  would_change: z.array(wouldChangeItem),
  preview: z
    .unknown()
    .describe(
      'The rollback preview of the executor, which depends on the tool',
    ),
  provisional: z.literal(true),
});

const customerProposalDiffItem = z.object({
  field: nonEmptyString,
  before_masked: z.string().nullable(),
  after_masked: z.string().nullable(),
});

const customerDuplicateCandidate = z.object({
  customer_id: idString,
  match_reasons: z.array(nonEmptyString),
  display_name_initials: z.string(),
});

function writeResultOf(tool: McpWriteToolName, extra: Shape = {}) {
  const shape = {
    ...optionalShape({
      ...extra,
      tool: z.literal(tool),
      tier: z.enum(['AUTO', 'PROPOSE']),
      status: z.enum(['executed', 'needs_approval']),
      would_change: z.array(wouldChangeItem),
      result: z.looseObject({ id: idString }),
      proposal: writeProposal,
      pending_action_id: idString,
      trace_id: idString,
      replayed: z.literal(true).optional(),
    }),
    ...optionalShape(truncatedMarkerShape),
  };
  return z.object(shape).superRefine((value, ctx) => {
    if (value.__truncated__ === true) {
      return;
    }
    const required =
      value.status === 'executed'
        ? ['tool', 'tier', 'would_change', 'result', 'trace_id']
        : value.status === 'needs_approval'
          ? [
              'tool',
              'tier',
              'would_change',
              'proposal',
              'pending_action_id',
              'trace_id',
            ]
          : ['status'];
    for (const key of required) {
      if ((value as Record<string, unknown>)[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required for status ${value.status ?? 'unknown'}`,
        });
      }
    }
    const expectedTier = value.status === 'needs_approval' ? 'PROPOSE' : 'AUTO';
    if (value.status !== undefined && value.tier !== expectedTier) {
      ctx.addIssue({
        code: 'custom',
        path: ['tier'],
        message: `tier must be ${expectedTier} for status ${value.status}`,
      });
    }
  });
}

const generateWeeklyReportPdfExecutedSchema = z
  .object({
    ...optionalShape({
      tool: z.literal('generate_weekly_report_pdf'),
      tier: z.enum(['AUTO', 'PROPOSE']),
      status: z.enum(['executed', 'needs_approval']),
      would_change: z.array(wouldChangeItem),
      result: z.object({
        id: idString,
        url: z.string().url(),
        expires_at: z.string().datetime(),
        sha256: z.string().length(64),
        page_count: z.number().int().positive(),
        period: z.object({
          from: z.string(),
          to: z.string(),
          timezone: z.string(),
          iso_week: z.string().nullable(),
        }),
      }),
      proposal: writeProposal,
      pending_action_id: idString,
      trace_id: idString,
      replayed: z.literal(true).optional(),
    }),
    ...optionalShape(truncatedMarkerShape),
  })
  .superRefine((value, ctx) => {
    if (value.__truncated__ === true) {
      return;
    }
    if (value.status === 'executed') {
      for (const key of [
        'tool',
        'tier',
        'would_change',
        'result',
        'trace_id',
      ] as const) {
        if ((value as Record<string, unknown>)[key] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required for executed weekly report PDF`,
          });
        }
      }
      if (value.tier !== 'AUTO') {
        ctx.addIssue({
          code: 'custom',
          path: ['tier'],
          message: 'tier must be AUTO for executed weekly report PDF',
        });
      }
    }
  });

export const mcpWriteToolOutputSchemas = {
  draft_workshop_order: mergeMcpWriteToolOutput(
    'draft_workshop_order',
    writeResultOf('draft_workshop_order'),
  ),
  reserve_part: mergeMcpWriteToolOutput(
    'reserve_part',
    writeResultOf('reserve_part'),
  ),
  release_reservation: mergeMcpWriteToolOutput(
    'release_reservation',
    writeResultOf('release_reservation'),
  ),
  propose_line_item: mergeMcpWriteToolOutput(
    'propose_line_item',
    writeResultOf('propose_line_item'),
  ),
  propose_registration_intake: mergeMcpWriteToolOutput(
    'propose_registration_intake',
    writeResultOf('propose_registration_intake'),
  ),
  propose_workshop_booking: mergeMcpWriteToolOutput(
    'propose_workshop_booking',
    writeResultOf('propose_workshop_booking'),
  ),
  propose_purchase_order: mergeMcpWriteToolOutput(
    'propose_purchase_order',
    writeResultOf('propose_purchase_order'),
  ),
  propose_workshop_order_completion: mergeMcpWriteToolOutput(
    'propose_workshop_order_completion',
    writeResultOf('propose_workshop_order_completion'),
  ),
  propose_invoice_draft_from_order: mergeMcpWriteToolOutput(
    'propose_invoice_draft_from_order',
    writeResultOf('propose_invoice_draft_from_order'),
  ),
  propose_estimate_send: mergeMcpWriteToolOutput(
    'propose_estimate_send',
    writeResultOf('propose_estimate_send'),
  ),
  request_workshop_media_upload: mergeMcpWriteToolOutput(
    'request_workshop_media_upload',
    writeResultOf('request_workshop_media_upload'),
  ),
  propose_mechanic_finding: mergeMcpWriteToolOutput(
    'propose_mechanic_finding',
    writeResultOf('propose_mechanic_finding'),
  ),
  propose_customer_create: mergeMcpWriteToolOutput(
    'propose_customer_create',
    writeResultOf('propose_customer_create', {
      diff: z.array(customerProposalDiffItem),
      duplicate_candidates: z.array(customerDuplicateCandidate),
    }),
  ),
  propose_customer_update: mergeMcpWriteToolOutput(
    'propose_customer_update',
    writeResultOf('propose_customer_update', {
      diff: z.array(customerProposalDiffItem),
      duplicate_candidates: z.array(customerDuplicateCandidate),
    }),
  ),
  generate_weekly_report_pdf: mergeMcpWriteToolOutput(
    'generate_weekly_report_pdf',
    generateWeeklyReportPdfExecutedSchema,
  ),
} satisfies Record<McpWriteToolName, z.ZodTypeAny>;
