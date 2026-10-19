import type { PendingActionType } from '../pending-action-executor/pending-action-executor.types.js';
import type { McpWriteToolName } from './mcp.constants.js';

export const ACTION_TYPE_BY_WRITE_TOOL: Record<
  McpWriteToolName,
  PendingActionType
> = {
  draft_workshop_order: 'workshop_order.create',
  reserve_part: 'inventory.part_reserve',
  release_reservation: 'inventory.part_release',
  propose_line_item: 'workshop_order.propose_line',
  propose_registration_intake: 'registration_intake.apply',
  propose_workshop_booking: 'workshop.booking_package',
  propose_purchase_order: 'purchase_order.propose_draft',
  propose_workshop_order_completion: 'workshop_order.complete',
  propose_invoice_draft_from_order: 'invoice.create_draft_from_workshop_order',
  propose_estimate_send: 'workshop_estimate.send',
  request_workshop_media_upload: 'workshop.media_upload_slot',
  propose_mechanic_finding: 'workshop_order.propose_mechanic_finding',
  generate_weekly_report_pdf: 'report.generate_weekly_pdf',
};

export const DRY_RUN_MINIMAL_INPUTS: Partial<
  Record<McpWriteToolName, Record<string, unknown>>
> = {
  draft_workshop_order: {
    vehicle_id: '00000000-0000-4000-8000-000000000002',
    status: 'SCHEDULED',
    bay_id: '00000000-0000-4000-8000-000000000003',
    scheduled_start_at: '2026-10-20T08:00:00Z',
    scheduled_end_at: '2026-10-20T09:00:00Z',
  },
  reserve_part: {
    workshop_task_line_item_id: '00000000-0000-4000-8000-000000000004',
    quantity: 1,
    location_id: '00000000-0000-4000-8000-000000000005',
  },
  release_reservation: {
    reservation_id: '00000000-0000-4000-8000-000000000007',
  },
  propose_line_item: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
    workshop_task_id: '00000000-0000-4000-8000-000000000006',
    expected_line_items_version: 0,
    line_item: {
      type: 'FEE',
      item_no: 'FEE-1',
      description: 'Test fee',
      quantity: 1,
      unit_price_cents: 100,
    },
  },
  propose_registration_intake: {
    intake_id: '00000000-0000-4000-8000-000000000008',
    vin: null,
    plate: 'W-12345',
    holder: { first_name: 'A', last_name: 'B' },
    nationalcode: null,
    first_registration: null,
  },
  propose_workshop_booking: {
    customer_id: '00000000-0000-4000-8000-000000000020',
    vehicle_id: '00000000-0000-4000-8000-000000000002',
    bay_id: '00000000-0000-4000-8000-000000000003',
    scheduled_start_at: '2026-10-20T08:00:00.000Z',
    scheduled_end_at: '2026-10-20T09:00:00.000Z',
  },
  propose_purchase_order: {
    vendor_id: '00000000-0000-4000-8000-000000000010',
    requisition_id: '00000000-0000-4000-8000-000000000011',
    lines: [
      {
        reservation_id: '00000000-0000-4000-8000-000000000012',
        catalog_item_id: '00000000-0000-4000-8000-000000000013',
        cost_basis: { version: 1, unit_cost_net: '10.00' },
      },
    ],
  },
  propose_workshop_order_completion: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
  },
  propose_invoice_draft_from_order: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
  },
  propose_estimate_send: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
    channel: 'email',
  },
  request_workshop_media_upload: {
    workshop_task_id: '00000000-0000-4000-8000-000000000006',
    mime_type: 'image/jpeg',
    size_bytes: 1024,
    purpose: 'MECHANIC_FINDING',
  },
  propose_mechanic_finding: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
    workshop_task_id: '00000000-0000-4000-8000-000000000006',
    description: 'Dry run finding',
  },
  generate_weekly_report_pdf: { iso_week: '2026-W42' },
};
