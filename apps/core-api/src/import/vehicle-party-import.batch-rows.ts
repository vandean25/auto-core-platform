import { ImportRowAction } from '@prisma/client';
import type { ImportApplyRow } from './import-type-handler.js';

/** Tenant vehicle id stored on planned vehicle-party rows at dry-run persist time. */
export function vehiclePartyVehicleId(row: ImportApplyRow): string | undefined {
  const normalized = row.normalized_json as Record<string, unknown> | null;
  const value = normalized?.vehicle_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function plannedOwnerCreate(row: ImportApplyRow): boolean {
  return row.action === ImportRowAction.CREATE;
}

/**
 * Builds the full apply list for one background worker page: the file slice plus any
 * peeked closing UPDATE that pairs with a CREATE on the same vehicle_id, every
 * lookahead row up to that update (gap fillers included), ordered UPDATE-first
 * without dropping rows to IMPORT_APPLY_BATCH_SIZE.
 */
export function buildVehiclePartyBackgroundApplyRows(
  fileBatch: ImportApplyRow[],
  lookahead: ImportApplyRow[],
): ImportApplyRow[] {
  const byRowNo = new Map(fileBatch.map((row) => [row.row_no, row]));
  const createVehicleIds = new Set(
    fileBatch
      .filter(plannedOwnerCreate)
      .map(vehiclePartyVehicleId)
      .filter((id): id is string => Boolean(id)),
  );
  let maxMergedLookaheadRowNo = 0;
  if (createVehicleIds.size > 0) {
    for (const row of lookahead) {
      if (row.action !== ImportRowAction.UPDATE) {
        continue;
      }
      const vehicleId = vehiclePartyVehicleId(row);
      if (vehicleId && createVehicleIds.has(vehicleId)) {
        byRowNo.set(row.row_no, row);
        maxMergedLookaheadRowNo = Math.max(maxMergedLookaheadRowNo, row.row_no);
      }
    }
    if (maxMergedLookaheadRowNo > 0) {
      for (const row of lookahead) {
        if (row.row_no <= maxMergedLookaheadRowNo) {
          byRowNo.set(row.row_no, row);
        }
      }
    }
  }
  return orderVehiclePartyApplyRows([...byRowNo.values()]);
}

export function orderVehiclePartyApplyRows(
  rows: ImportApplyRow[],
): ImportApplyRow[] {
  const updates = rows
    .filter((row) => row.action === ImportRowAction.UPDATE)
    .sort((a, b) => a.row_no - b.row_no);
  const rest = rows
    .filter((row) => row.action !== ImportRowAction.UPDATE)
    .sort((a, b) => a.row_no - b.row_no);
  return [...updates, ...rest];
}
