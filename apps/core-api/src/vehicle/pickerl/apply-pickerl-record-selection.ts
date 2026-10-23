import { VehicleInspectionRecordSource } from '@prisma/client';
import type {
  PickerlInspectionRecordInput,
  PickerlWarning,
} from './compute-pickerl-due.js';

export type PickerlRecordSourceRow = PickerlInspectionRecordInput & {
  source?: VehicleInspectionRecordSource;
  external_inspection_result_id?: string | null;
};

export type PickerlBarrierFlags = {
  externalConflictBarrier?: boolean;
  negativeBarrier?: boolean;
};

const MANUAL_EXPIRY_AMBIGUITY: PickerlWarning = {
  code: 'MANUAL_EXPIRY_AMBIGUITY',
  message:
    'Mehrere manuelle Begutachtungen am selben Tag mit unterschiedlicher Plaketten-Gültigkeit.',
};

const EXTERNAL_REVIEW: PickerlWarning = {
  code: 'EXTERNAL_RESULT_REQUIRES_REVIEW',
  message:
    'Externes Begutachtungsergebnis erfordert Prüfung — Fälligkeit nicht verlässlich.',
};

function formatDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function expiryKey(record: PickerlInspectionRecordInput): string {
  return `${record.plaketten_valid_until_year}-${String(record.plaketten_valid_until_month).padStart(2, '0')}`;
}

export function selectPickerlComputationRecords(
  rows: PickerlRecordSourceRow[],
  barriers: PickerlBarrierFlags = {},
): {
  records: PickerlInspectionRecordInput[];
  extraWarnings: PickerlWarning[];
  forceUnknown: boolean;
} {
  const extraWarnings: PickerlWarning[] = [];
  let forceUnknown = false;

  if (barriers.externalConflictBarrier || barriers.negativeBarrier) {
    extraWarnings.push(EXTERNAL_REVIEW);
    forceUnknown = true;
  }

  const manualByDay = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.source !== VehicleInspectionRecordSource.MANUAL) continue;
    const day = formatDateKey(row.inspected_on);
    const expiries = manualByDay.get(day) ?? new Set<string>();
    expiries.add(expiryKey(row));
    manualByDay.set(day, expiries);
  }
  const manualAmbiguity = [...manualByDay.values()].some(
    (expiries) => expiries.size > 1,
  );
  if (manualAmbiguity) {
    extraWarnings.push(MANUAL_EXPIRY_AMBIGUITY);
    forceUnknown = true;
  }

  const usedExternal = new Set<string>();
  const selected: PickerlInspectionRecordInput[] = [];

  const ordered = [...rows].sort(
    (left, right) =>
      new Date(left.inspected_on).getTime() -
      new Date(right.inspected_on).getTime(),
  );

  for (const row of ordered) {
    if (
      row.source === VehicleInspectionRecordSource.EBV_IMPORTED &&
      row.external_inspection_result_id
    ) {
      if (usedExternal.has(row.external_inspection_result_id)) {
        continue;
      }
      usedExternal.add(row.external_inspection_result_id);
    }

    const duplicate = selected.some(
      (existing) =>
        formatDateKey(existing.inspected_on) ===
          formatDateKey(row.inspected_on) &&
        expiryKey(existing) === expiryKey(row),
    );
    if (duplicate) {
      continue;
    }

    selected.push({
      inspected_on: row.inspected_on,
      plaketten_valid_until_year: row.plaketten_valid_until_year,
      plaketten_valid_until_month: row.plaketten_valid_until_month,
    });
  }

  return { records: selected, extraWarnings, forceUnknown };
}
