import { computePickerlDue } from './compute-pickerl-due.js';
import type { PickerlInspectionRecordInput } from './compute-pickerl-due.js';
import {
  selectPickerlComputationRecords,
  type PickerlBarrierFlags,
  type PickerlRecordSourceRow,
} from './apply-pickerl-record-selection.js';

type VehicleWithPickerlFields = {
  first_registration_date?: Date | string | null;
  inspection_records?: PickerlRecordSourceRow[];
  pickerl_barriers?: PickerlBarrierFlags;
};

function formatInspectionDate(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0] ?? null;
}

export function attachPickerlDue<T extends VehicleWithPickerlFields>(
  vehicle: T,
  onDate: Date,
) {
  const { inspection_records = [], pickerl_barriers, ...rest } = vehicle;
  const selection = selectPickerlComputationRecords(
    inspection_records,
    pickerl_barriers,
  );
  const orderedRecords = [...selection.records].sort(
    (left, right) =>
      new Date(left.inspected_on).getTime() -
      new Date(right.inspected_on).getTime(),
  );
  const latestRecord = orderedRecords[orderedRecords.length - 1];
  const base = computePickerlDue(
    { first_registration_date: vehicle.first_registration_date },
    selection.records,
    onDate,
  );
  const pickerl_due = {
    ...base,
    status: selection.forceUnknown ? 'UNKNOWN' : base.status,
    warnings: [...base.warnings, ...selection.extraWarnings],
    last_inspected_on: formatInspectionDate(latestRecord?.inspected_on),
  };
  return {
    ...rest,
    pickerl_due,
  };
}
