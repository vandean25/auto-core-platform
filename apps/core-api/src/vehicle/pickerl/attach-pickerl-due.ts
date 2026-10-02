import { computePickerlDue } from './compute-pickerl-due.js';
import type { PickerlInspectionRecordInput } from './compute-pickerl-due.js';

type VehicleWithPickerlFields = {
  first_registration_date?: Date | string | null;
  inspection_records?: PickerlInspectionRecordInput[];
};

export function attachPickerlDue<T extends VehicleWithPickerlFields>(
  vehicle: T,
  onDate: Date,
) {
  const records = vehicle.inspection_records ?? [];
  const pickerl_due = computePickerlDue(
    { first_registration_date: vehicle.first_registration_date },
    records,
    onDate,
  );
  const { inspection_records: _records, ...rest } = vehicle;
  return {
    ...rest,
    pickerl_due,
  };
}
