export const POSITION_PLAN_VERSION = 1;
export const PLAN_STALE = 'PLAN_STALE';

export type PositionPlanReservationState =
  'not_applicable' | 'unbooked' | 'reserved';

export type PositionPlanQuestion = {
  code: string;
  message: string;
  preset_key?: string;
  labor_operation_id?: string;
  catalog_item_id?: string;
};

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
  questions?: PositionPlanQuestion[];
};
