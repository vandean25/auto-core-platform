import {
  EmployeeRole,
  LoanerBookingStatus,
  WorkshopCheckInStatus,
  WorkshopEstimateStatus,
} from '@prisma/client';
import { z } from 'zod';
import type { McpWave2ReadToolName } from './mcp-read-tool-catalog.aut615.js';
import {
  mcpOutputIdString,
  mcpOutputIsoDateOnly,
  mcpOutputIsoDateTime,
  mcpOutputNullableIsoDateTime,
  mcpOutputResultOf,
} from './mcp-tool-output-schema.util.js';
const pageMeta = z.object({
  page_size: z.number().int(),
  next_cursor: z.string().nullable(),
});

export const mcpWave2ReadOutputSchemas: Record<
  McpWave2ReadToolName,
  z.ZodTypeAny
> = {
  list_loaner_bookings: mcpOutputResultOf({
    site_id: mcpOutputIdString,
    as_of: mcpOutputIsoDateTime,
    data: z.array(
      z.object({
        id: mcpOutputIdString,
        loaner: z.object({
          id: mcpOutputIdString,
          display_name: z.string(),
        }),
        customer_ref: z.object({
          id: mcpOutputIdString,
          display_name: z.string(),
        }),
        order_ref: z
          .object({
            id: mcpOutputIdString,
          })
          .nullable(),
        planned_pickup_at: mcpOutputIsoDateTime,
        planned_return_at: mcpOutputIsoDateTime,
        actual_pickup_at: mcpOutputNullableIsoDateTime,
        actual_return_at: mcpOutputNullableIsoDateTime,
        status: z.nativeEnum(LoanerBookingStatus),
        overdue: z.boolean(),
      }),
    ),
    meta: pageMeta,
  }),
  list_estimates: mcpOutputResultOf({
    site_id: mcpOutputIdString,
    data: z.array(
      z.object({
        version_id: mcpOutputIdString,
        order_ref: z.object({
          id: mcpOutputIdString,
          number: z.string(),
        }),
        customer_ref: z.object({
          id: mcpOutputIdString,
        }),
        status: z.nativeEnum(WorkshopEstimateStatus),
        total_net: z.string().nullable(),
        total_gross: z.string().nullable(),
        sent_at: mcpOutputNullableIsoDateTime,
        decided_at: mcpOutputNullableIsoDateTime,
        channel: z.string().nullable(),
      }),
    ),
    meta: pageMeta,
  }),
  list_order_communications: mcpOutputResultOf({
    site_id: mcpOutputIdString,
    order_id: mcpOutputIdString,
    data: z.array(
      z.object({
        id: mcpOutputIdString,
        at: mcpOutputIsoDateTime,
        channel: z.string().nullable(),
        direction: z.enum(['OUTBOUND', 'INBOUND', 'INTERNAL']),
        event_type: z.string(),
        delivery_state: z.string().nullable(),
        template_id: z.string().nullable(),
        recipient_masked: z.string().nullable(),
      }),
    ),
    meta: pageMeta,
  }),
  get_check_in: mcpOutputResultOf({
    site_id: mcpOutputIdString,
    order_id: mcpOutputIdString,
    status: z.nativeEnum(WorkshopCheckInStatus),
    completed_at: mcpOutputNullableIsoDateTime,
    checklist: z.object({
      ok_count: z.number().int(),
      flagged_count: z.number().int(),
      flagged_items: z.array(
        z.object({
          id: mcpOutputIdString,
          label: z.string(),
        }),
      ),
    }),
    damage_marker_count: z.number().int(),
    damage_zones: z.array(z.string()),
    signature_captured: z.boolean(),
    media: z.array(
      z.object({
        id: mcpOutputIdString,
        purpose: z.string(),
      }),
    ),
  }),
  get_staff_availability: mcpOutputResultOf({
    date: mcpOutputIsoDateOnly,
    site_id: mcpOutputIdString,
    employees: z.array(
      z.object({
        employee_id: mcpOutputIdString,
        display_name: z.string(),
        role: z.nativeEnum(EmployeeRole),
        present_now: z.boolean(),
        scheduled_hours: z.string(),
        on_leave: z.boolean(),
      }),
    ),
  }),
};
