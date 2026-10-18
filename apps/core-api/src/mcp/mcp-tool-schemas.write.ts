import { z } from 'zod';
import { MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';
import { proposeWorkshopBookingInputSchema } from '../workshop/workshop-booking-package.schema.js';
import {
  proposeMechanicFindingInputSchema,
  requestWorkshopMediaUploadInputSchema,
} from '../mechanic/mechanic-finding-propose.schema.js';
import { proposePurchaseOrderInputSchema } from '../purchase/purchase-propose-draft.schema.js';
import { generateWeeklyReportPdfInputSchema } from '../reports/weekly-report/weekly-report-mcp.schema.js';
import { proposeWorkshopOrderCompletionInputSchema } from '../workshop/workshop-order-completion.schema.js';
import { proposeInvoiceDraftFromOrderInputSchema } from '../invoices/invoice-workshop-draft-propose.schema.js';
import { proposeEstimateSendInputSchema } from '../workshop/workshop-estimate-send-propose.schema.js';
import {
  dryRunArg,
  withMcpWriteDryRunInput,
} from './mcp-write-dry-run.schema.js';

const uuidSchema = z.string().uuid();

const workshopOrderPurposeSchema = z.enum(['CUSTOMER_REPAIR', 'STOCK_PREP']);
const workshopOrderDraftStatusSchema = z.literal('SCHEDULED');

const optionalMcpCommandIdSchema = {
  command_id: uuidSchema
    .optional()
    .describe(
      'Client idempotency key for AUTO/PROPOSE writes. Replays return the same committed result or pending action.',
    ),
};

export const draftWorkshopOrderInputSchema = z
  .object({
    customer_id: uuidSchema.optional(),
    vehicle_id: uuidSchema,
    purpose: workshopOrderPurposeSchema.optional(),
    status: workshopOrderDraftStatusSchema,
    bay_id: uuidSchema.describe('Required bay ID for a scheduled draft'),
    mechanic_id: uuidSchema.optional(),
    scheduled_start_at: z.string().describe('Required scheduled start time'),
    scheduled_end_at: z.string().describe('Required scheduled end time'),
    odometer: z.number().int().min(0).optional(),
    fuel_level: z.number().int().min(0).max(100).optional(),
    reported_issue: z.string().optional(),
    notes: z.string().optional(),
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
  })
  .strict();

export const reservePartInputSchema = z
  .object({
    workshop_task_line_item_id: uuidSchema.describe(
      'ID of a catalog-backed PART line item on a workshop task; free-text lines are not supported',
    ),
    quantity: z.number().min(0.001),
    location_id: uuidSchema.describe(
      'ID of a bin storage location at the active site',
    ),
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
  })
  .strict()
  .describe(
    'Reservations use the existing EUR 250 platform amount_max: AUTO at or below the effective policy amount_max and PROPOSE above it.',
  );

export const releaseReservationInputSchema = z
  .object({
    reservation_id: uuidSchema,
    return_location_id: uuidSchema.optional(),
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
  })
  .strict();

export const proposeRegistrationIntakeInputSchema = z
  .object({
    intake_id: uuidSchema,
    vin: z.string().nullable(),
    plate: z.string(),
    holder: z
      .object({
        first_name: z.string(),
        last_name: z.string(),
      })
      .strict(),
    nationalcode: z.string().nullable(),
    first_registration: z.string().nullable(),
    co2: z
      .object({
        value: z.number().int().min(0).max(600),
        cycle: z.enum(['WLTP', 'NEDC']),
      })
      .nullable()
      .optional(),
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.number().int().min(1900).optional(),
    customer_id: uuidSchema.optional(),
    vehicle_id: uuidSchema.optional(),
    ownership_correction: z
      .object({
        expected_customer_id: uuidSchema.nullable(),
        next_customer_id: uuidSchema,
      })
      .strict()
      .optional(),
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
  })
  .strict();

export const proposeLineItemInputSchema = z
  .object({
    workshop_order_id: uuidSchema,
    workshop_task_id: uuidSchema,
    expected_line_items_version: z.number().int().min(0),
    line_item: z
      .object({
        type: z.enum(['PART', 'LABOR', 'FEE']),
        item_no: z.string().min(1),
        description: z.string().min(1),
        quantity: z.number().min(0.001),
        unit_price_cents: z.number().int().min(0),
        labor_operation_id: uuidSchema.optional(),
      })
      .strict()
      .superRefine((line, ctx) => {
        if (line.type === 'FEE' && line.labor_operation_id !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'FEE lines cannot reference labor_operation_id',
          });
        }
      }),
    ...optionalMcpCommandIdSchema,
    ...dryRunArg,
  })
  .strict();

export const mcpWriteToolInputSchemas: Record<
  (typeof MCP_WRITE_TOOL_NAMES)[number],
  z.ZodTypeAny
> = {
  draft_workshop_order: draftWorkshopOrderInputSchema,
  reserve_part: reservePartInputSchema,
  release_reservation: releaseReservationInputSchema,
  propose_line_item: proposeLineItemInputSchema,
  propose_registration_intake: proposeRegistrationIntakeInputSchema,
  propose_workshop_booking: withMcpWriteDryRunInput(
    proposeWorkshopBookingInputSchema,
  ),
  propose_purchase_order: withMcpWriteDryRunInput(
    proposePurchaseOrderInputSchema,
  ),
  propose_workshop_order_completion: withMcpWriteDryRunInput(
    proposeWorkshopOrderCompletionInputSchema,
  ),
  propose_invoice_draft_from_order: withMcpWriteDryRunInput(
    proposeInvoiceDraftFromOrderInputSchema,
  ),
  propose_estimate_send: withMcpWriteDryRunInput(
    proposeEstimateSendInputSchema,
  ),
  request_workshop_media_upload: withMcpWriteDryRunInput(
    requestWorkshopMediaUploadInputSchema,
  ),
  propose_mechanic_finding: withMcpWriteDryRunInput(
    proposeMechanicFindingInputSchema,
  ),
  generate_weekly_report_pdf: withMcpWriteDryRunInput(
    generateWeeklyReportPdfInputSchema,
  ),
};
