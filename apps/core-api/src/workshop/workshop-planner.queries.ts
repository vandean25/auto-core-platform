import {
  LeaveRequestStatus,
  WorkshopOrderStatus,
  type Prisma,
} from '@prisma/client';
import type { PlannerRange } from './workshop-planner.window.js';

const ACTIVE_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];
const FLOOR_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

// The tenant and site scope (`tenant_id`, `site_id`) is written at each Prisma call
// site in the service, so it stays visible where the query runs. These builders only
// add the planner's own filters on top of that scope.

/** Active bays, optionally narrowed to one bay. */
export function plannerBayFilter(
  bayId?: string,
): Pick<Prisma.BayWhereInput, 'is_active' | 'id'> {
  return { is_active: true, ...(bayId ? { id: bayId } : {}) };
}

/**
 * Active orders that either overlap the range by their scheduled slot or sit on the
 * floor without a slot (INTAKE / IN_PROGRESS).
 */
export function plannerOrderFilter(
  range: PlannerRange,
  bayId?: string,
): Pick<Prisma.WorkshopOrderWhereInput, 'status' | 'bay_id' | 'OR'> {
  return {
    status: { in: ACTIVE_STATUSES },
    bay_id: bayId ? bayId : { not: null },
    OR: [
      {
        scheduled_start_at: { lt: range.to },
        scheduled_end_at: { gt: range.from },
      },
      {
        scheduled_start_at: null,
        scheduled_end_at: null,
        status: { in: FLOOR_STATUSES },
      },
    ],
  };
}

/** Booked leave only, so cancelled leave never shows as away. */
export function plannerLeaveFilter(bounds: {
  fromLocalDate: Date;
  toLocalDate: Date;
}): Pick<Prisma.LeaveRequestWhereInput, 'status' | 'start_on' | 'end_on'> {
  return {
    status: LeaveRequestStatus.BOOKED,
    start_on: { lte: bounds.toLocalDate },
    end_on: { gte: bounds.fromLocalDate },
  };
}
