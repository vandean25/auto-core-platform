export const POSITION_PLAN_VERSION = 1;
export const PLAN_STALE = 'PLAN_STALE';
export const DEFERRED_PART_RESERVATION_MARKER = 'booking-plan:defer-reserve';

export type PositionPlanReservationState =
  'not_applicable' | 'unbooked' | 'reserved';

export type ResolvedPositionPlanLine = {
  presetKey?: string;
  kind: 'LABOR' | 'PART';
  laborOperationId: string | null;
  catalogItemId: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  netCents: number;
  reservation: PositionPlanReservationState;
  durationMinutes?: number;
  quantityMilli?: number;
};

export type ResolvedPositionPlan = {
  version: number;
  lines: ResolvedPositionPlanLine[];
  fingerprint: string;
};
