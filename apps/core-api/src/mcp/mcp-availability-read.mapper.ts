import type { LoanerVehicleStatus } from '@prisma/client';
import type { WorkshopSlotCandidate } from '../workshop/workshop-planner.slots.js';
import { decodeMcpCursor, encodeMcpCursor } from './mcp-output.util.js';

export const MCP_AVAILABILITY_SNAPSHOT_NOTE =
  'Availability is a point-in-time snapshot. Re-check immediately before booking.';

export type McpAvailabilityPageScope = {
  offset: number;
  pageSize: number;
};

export function availabilityOffsetFromCursor(
  cursor: string | undefined,
): number {
  return cursor === undefined ? 0 : (decodeMcpCursor(cursor) ?? 0);
}

export function toMcpAvailabilityPageMeta(
  total: number,
  scope: McpAvailabilityPageScope,
) {
  const nextOffset = scope.offset + scope.pageSize;
  return {
    total,
    page_size: scope.pageSize,
    next_cursor: nextOffset < total ? encodeMcpCursor(nextOffset) : null,
  };
}

export function toMcpWorkshopSlotRow(slot: WorkshopSlotCandidate) {
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
