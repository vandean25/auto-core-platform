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

function createVehicleIdsInBatch(fileBatch: ImportApplyRow[]): Set<string> {
  return new Set(
    fileBatch
      .filter(plannedOwnerCreate)
      .map(vehiclePartyVehicleId)
      .filter((id): id is string => Boolean(id)),
  );
}

function maxClosingUpdateRowNo(
  lookahead: ImportApplyRow[],
  createVehicleIds: Set<string>,
  byRowNo: Map<number, ImportApplyRow>,
): number {
  let maxMergedLookaheadRowNo = 0;
  for (const row of lookahead) {
    if (row.action !== ImportRowAction.UPDATE) {
      continue;
    }
    const vehicleId = vehiclePartyVehicleId(row);
    if (!vehicleId || !createVehicleIds.has(vehicleId)) {
      continue;
    }
    byRowNo.set(row.row_no, row);
    maxMergedLookaheadRowNo = Math.max(maxMergedLookaheadRowNo, row.row_no);
  }
  return maxMergedLookaheadRowNo;
}

function includeLookaheadRowsThrough(
  lookahead: ImportApplyRow[],
  throughRowNo: number,
  byRowNo: Map<number, ImportApplyRow>,
): void {
  for (const row of lookahead) {
    if (row.row_no <= throughRowNo) {
      byRowNo.set(row.row_no, row);
    }
  }
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
  const createVehicleIds = createVehicleIdsInBatch(fileBatch);
  if (createVehicleIds.size === 0) {
    return orderVehiclePartyApplyRows([...byRowNo.values()]);
  }
  const maxMergedLookaheadRowNo = maxClosingUpdateRowNo(
    lookahead,
    createVehicleIds,
    byRowNo,
  );
  if (maxMergedLookaheadRowNo > 0) {
    includeLookaheadRowsThrough(lookahead, maxMergedLookaheadRowNo, byRowNo);
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
