import type { LoanerVehicleStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { WorkshopSlotCandidate } from '../workshop/workshop-planner.slots.js';
import {
  decodeMcpPositionCursor,
  encodeMcpPositionCursor,
} from './mcp-output.util.js';

export const MCP_AVAILABILITY_SNAPSHOT_NOTE =
  'Availability is a point-in-time snapshot. Re-check immediately before booking.';

export const workshopSlotCursorPositionSchema = z.object({
  start_at: z.string().datetime(),
  bay_id: z.string().uuid(),
});

export const loanerAvailabilityCursorPositionSchema = z.object({
  loaner_vehicle_id: z.string().uuid(),
});

export type McpWorkshopSlotRow = {
  bay_id: string;
  start_at: string;
  end_at: string;
};

export function toMcpWorkshopSlotRow(slot: WorkshopSlotCandidate): McpWorkshopSlotRow {
  return {
    bay_id: slot.bayId,
    start_at: slot.startAt.toISOString(),
    end_at: slot.endAt.toISOString(),
  };
}

export type McpAvailableLoanerRow = {
  loaner_vehicle_id: string;
  vehicle_id: string;
  display_name: string;
  status: LoanerVehicleStatus;
};

export function toMcpAvailableLoanerRow(input: {
  id: string;
  vehicleId: string;
  displayName: string;
  status: LoanerVehicleStatus;
}): McpAvailableLoanerRow {
  return {
    loaner_vehicle_id: input.id,
    vehicle_id: input.vehicleId,
    display_name: input.displayName,
    status: input.status,
  };
}

function compareWorkshopSlotRows(
  a: McpWorkshopSlotRow,
  b: McpWorkshopSlotRow,
): number {
  return (
    a.start_at.localeCompare(b.start_at) || a.bay_id.localeCompare(b.bay_id)
  );
}

function isWorkshopSlotAfter(
  row: McpWorkshopSlotRow,
  position: z.infer<typeof workshopSlotCursorPositionSchema>,
): boolean {
  return compareWorkshopSlotRows(row, {
    bay_id: position.bay_id,
    start_at: position.start_at,
    end_at: '',
  }) > 0;
}

function isLoanerRowAfter(
  row: McpAvailableLoanerRow,
  position: z.infer<typeof loanerAvailabilityCursorPositionSchema>,
): boolean {
  return row.loaner_vehicle_id.localeCompare(position.loaner_vehicle_id) > 0;
}

function decodePositionCursor<P>(
  cursor: string,
  schema: z.ZodType<P>,
): P {
  const parsed = schema.safeParse(decodeMcpPositionCursor(cursor));
  if (!parsed.success) {
    throw new BadRequestException('cursor is invalid');
  }
  return parsed.data;
}

export function paginateWorkshopSlotRows(
  rows: McpWorkshopSlotRow[],
  pageSize: number,
  cursor?: string,
) {
  const sorted = [...rows].sort(compareWorkshopSlotRows);
  let start = 0;
  if (cursor) {
    const position = decodePositionCursor(
      cursor,
      workshopSlotCursorPositionSchema,
    );
    const index = sorted.findIndex((row) => isWorkshopSlotAfter(row, position));
    start = index === -1 ? sorted.length : index;
  }
  const data = sorted.slice(start, start + pageSize);
  const next_cursor =
    start + pageSize < sorted.length && data.length > 0
      ? encodeMcpPositionCursor({
          start_at: data[data.length - 1]!.start_at,
          bay_id: data[data.length - 1]!.bay_id,
        })
      : null;
  return {
    data,
    meta: { total: sorted.length, page_size: pageSize, next_cursor },
  };
}

export function paginateLoanerRows(
  rows: McpAvailableLoanerRow[],
  pageSize: number,
  cursor?: string,
) {
  const sorted = [...rows].sort((a, b) =>
    a.loaner_vehicle_id.localeCompare(b.loaner_vehicle_id),
  );
  let start = 0;
  if (cursor) {
    const position = decodePositionCursor(
      cursor,
      loanerAvailabilityCursorPositionSchema,
    );
    const index = sorted.findIndex((row) => isLoanerRowAfter(row, position));
    start = index === -1 ? sorted.length : index;
  }
  const data = sorted.slice(start, start + pageSize);
  const next_cursor =
    start + pageSize < sorted.length && data.length > 0
      ? encodeMcpPositionCursor({
          loaner_vehicle_id: data[data.length - 1]!.loaner_vehicle_id,
        })
      : null;
  return {
    data,
    meta: { total: sorted.length, page_size: pageSize, next_cursor },
  };
}
