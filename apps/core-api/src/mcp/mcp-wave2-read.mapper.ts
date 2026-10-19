import type { LoanerBookingResponse } from '../loaner-vehicles/loaner.mapper.js';
import { ACTIVE_LOANER_BOOKING_STATUSES } from '../loaner-vehicles/loaner.constants.js';
import type { WorkshopOrderCommunicationDto } from '../workshop/dto/workshop-order-communications.dto.js';
import type { SiteEstimateVersionListRow } from '../workshop/workshop-estimate-version-site-list.read.js';
import type { WorkshopCheckInResponseDto } from '../workshop/dto/workshop-check-in.dto.js';
import {
  decodeMcpPositionCursor,
  encodeMcpPositionCursor,
} from './mcp-output.util.js';
import { z } from 'zod';

const bookingCursorSchema = z.object({ id: z.string().uuid() });
const estimateCursorSchema = z.object({
  sent_at: z.string().datetime().nullable(),
  id: z.string().uuid(),
});

export function isLoanerBookingOverdue(
  booking: Pick<LoanerBookingResponse, 'status' | 'plannedTo' | 'returnedAt'>,
  asOf: Date,
): boolean {
  if (booking.returnedAt) {
    return false;
  }
  if (
    !ACTIVE_LOANER_BOOKING_STATUSES.includes(
      booking.status as (typeof ACTIVE_LOANER_BOOKING_STATUSES)[number],
    )
  ) {
    return false;
  }
  return booking.plannedTo.getTime() < asOf.getTime();
}

export function toMcpLoanerBookingRow(
  booking: LoanerBookingResponse,
  asOf: Date,
) {
  return {
    id: booking.id,
    loaner: {
      id: booking.loanerVehicleId,
      display_name: booking.loanerVehicle?.displayName ?? '',
    },
    customer_ref: {
      id: booking.customerId,
      display_name: formatCustomerRef(booking.customer),
    },
    order_ref: booking.workshopOrderId ? { id: booking.workshopOrderId } : null,
    planned_pickup_at: booking.plannedFrom.toISOString(),
    planned_return_at: booking.plannedTo.toISOString(),
    actual_pickup_at: booking.handedOverAt
      ? booking.handedOverAt.toISOString()
      : null,
    actual_return_at: booking.returnedAt
      ? booking.returnedAt.toISOString()
      : null,
    status: booking.status,
    overdue: isLoanerBookingOverdue(booking, asOf),
  };
}

function formatCustomerRef(customer?: {
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  if (!customer) {
    return '';
  }
  if (customer.companyName) {
    return customer.companyName;
  }
  return [customer.firstName, customer.lastName].filter(Boolean).join(' ');
}

export function toMcpEstimateVersionRow(row: SiteEstimateVersionListRow) {
  return {
    id: row.id,
    version_id: row.id,
    order_ref: {
      id: row.estimate.workshop_order_id,
      number: row.estimate.workshop_order.order_number,
    },
    customer_ref: {
      id: row.estimate.workshop_order.customer_id,
    },
    status: row.status,
    total_net: row.total_net ? row.total_net.toFixed(2) : null,
    total_gross: row.total_gross ? row.total_gross.toFixed(2) : null,
    sent_at: row.sent_at ? row.sent_at.toISOString() : null,
    decided_at: row.decided_at ? row.decided_at.toISOString() : null,
    channel: row.channel,
  };
}

const COMMUNICATION_DIRECTION: Record<
  WorkshopOrderCommunicationDto['kind'],
  'OUTBOUND' | 'INBOUND' | 'INTERNAL'
> = {
  ESTIMATE_EMAIL: 'OUTBOUND',
  READY_EMAIL: 'OUTBOUND',
  ESTIMATE_APPROVAL: 'INBOUND',
  OVERRUN_DETECTED: 'INTERNAL',
  OVERRUN_NOTIFICATION: 'OUTBOUND',
};

export function toMcpOrderCommunicationRow(row: WorkshopOrderCommunicationDto) {
  const mapped = {
    id: row.id,
    at: row.occurred_at,
    channel: row.channel,
    direction: COMMUNICATION_DIRECTION[row.kind],
    event_type: row.kind,
    delivery_state: row.status,
    template_id: null,
    recipient_masked: null,
  };
  return mapped;
}

type ChecklistItem = {
  id: string;
  label_snapshot: string;
  passed: boolean | null;
};

type CheckInMediaItem = {
  id: string;
  purpose: string;
};

export function toMcpCheckInSummary(
  row: WorkshopCheckInResponseDto,
  checklist: ChecklistItem[],
  media: CheckInMediaItem[],
) {
  const markers = (row.damage_markers_json ?? []) as Array<{
    zone_id?: string;
  }>;
  const zones = [
    ...new Set(markers.map((marker) => marker.zone_id).filter(Boolean)),
  ].sort() as string[];
  const flagged = checklist.filter((item) => item.passed === false);

  return {
    status: row.status,
    completed_at: row.completed_at ?? null,
    checklist: {
      ok_count: checklist.filter((item) => item.passed === true).length,
      flagged_count: flagged.length,
      flagged_items: flagged.map((item) => ({
        id: item.id,
        label: item.label_snapshot,
      })),
    },
    damage_marker_count: markers.length,
    damage_zones: zones,
    signature_captured: Boolean(row.signed_at ?? row.signature_media_id),
    media: media.map((item) => ({
      id: item.id,
      purpose: item.purpose,
    })),
  };
}

export function paginateLoanerBookings<T extends { id: string }>(
  rows: T[],
  pageSize: number,
  cursor?: string,
) {
  const startIndex =
    cursor === undefined
      ? 0
      : rows.findIndex((row) => row.id === decodeBookingCursor(cursor)) + 1;
  const slice = rows.slice(Math.max(0, startIndex), startIndex + pageSize);
  const next =
    startIndex + pageSize < rows.length && slice.length > 0
      ? encodeMcpPositionCursor({ id: slice[slice.length - 1].id })
      : null;
  return {
    data: slice,
    meta: { page_size: pageSize, next_cursor: next },
  };
}

export function paginateEstimateVersions<
  T extends { id: string; sent_at: string | null },
>(rows: T[], pageSize: number, cursor?: string) {
  const startIndex =
    cursor === undefined ? 0 : findEstimateStartIndex(rows, cursor);
  const slice = rows.slice(startIndex, startIndex + pageSize);
  const next =
    startIndex + pageSize < rows.length && slice.length > 0
      ? encodeEstimateCursor(slice[slice.length - 1])
      : null;
  return {
    data: slice,
    meta: { page_size: pageSize, next_cursor: next },
  };
}

const communicationCursorSchema = z.object({
  at: z.string().datetime(),
  id: z.string().uuid(),
  event_type: z.string().min(1),
});

export function paginateCommunications<
  T extends { id: string; at: string; event_type: string },
>(rows: T[], pageSize: number, cursor?: string) {
  const startIndex =
    cursor === undefined ? 0 : findCommunicationStartIndex(rows, cursor);
  const slice = rows.slice(startIndex, startIndex + pageSize);
  const last = slice[slice.length - 1];
  const next =
    startIndex + pageSize < rows.length && last
      ? encodeCommunicationCursor(last)
      : null;
  return {
    data: slice,
    meta: { page_size: pageSize, next_cursor: next },
  };
}

function findCommunicationStartIndex<T extends { id: string; at: string; event_type: string }>(
  rows: T[],
  cursor: string,
): number {
  const decoded = decodeMcpPositionCursor(cursor);
  const parsed = communicationCursorSchema.safeParse(decoded);
  if (!parsed.success) {
    return 0;
  }
  const { at, id, event_type } = parsed.data;
  const index = rows.findIndex(
    (row) => row.at === at && row.id === id && row.event_type === event_type,
  );
  return index < 0 ? 0 : index + 1;
}

function encodeCommunicationCursor(row: {
  at: string;
  id: string;
  event_type: string;
}): string {
  return encodeMcpPositionCursor({
    at: row.at,
    id: row.id,
    event_type: row.event_type,
  });
}

function decodeBookingCursor(cursor: string): string {
  const decoded = decodeMcpPositionCursor(cursor);
  const parsed = bookingCursorSchema.safeParse(decoded);
  if (!parsed.success) {
    return cursor;
  }
  return parsed.data.id;
}

function findEstimateStartIndex<
  T extends { id: string; sent_at: string | null },
>(rows: T[], cursor: string): number {
  const decoded = decodeMcpPositionCursor(cursor);
  const parsed = estimateCursorSchema.safeParse(decoded);
  if (!parsed.success) {
    return 0;
  }
  const index = rows.findIndex(
    (row) => row.id === parsed.data.id && row.sent_at === parsed.data.sent_at,
  );
  return index < 0 ? 0 : index + 1;
}

function encodeEstimateCursor(row: { id: string; sent_at: string | null }) {
  return encodeMcpPositionCursor({
    id: row.id,
    sent_at: row.sent_at,
  });
}
