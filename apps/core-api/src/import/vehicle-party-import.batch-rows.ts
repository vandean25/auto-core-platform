import { ImportRowAction } from '@prisma/client';
import type { ImportApplyRow } from './import-type-handler.js';

function vehicleExternalId(row: ImportApplyRow): string | undefined {
  const normalized = row.normalized_json as Record<string, unknown> | null;
  const value = normalized?.vehicle_external_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Pulls a closing UPDATE from the peek row when the batch ends with a new owner CREATE. */
export function expandVehiclePartyBatchWithLookahead(
  batchRows: ImportApplyRow[],
  lookahead: ImportApplyRow[],
): ImportApplyRow[] {
  if (lookahead.length === 0 || batchRows.length === 0) {
    return batchRows;
  }
  const createVehicles = new Set(
    batchRows
      .filter((row) => row.action === ImportRowAction.CREATE)
      .map(vehicleExternalId)
      .filter((id): id is string => Boolean(id)),
  );
  if (createVehicles.size === 0) {
    return batchRows;
  }
  const merged = new Map(batchRows.map((row) => [row.row_no, row]));
  for (const row of lookahead) {
    if (row.action !== ImportRowAction.UPDATE) {
      continue;
    }
    const vehicleId = vehicleExternalId(row);
    if (vehicleId && createVehicles.has(vehicleId)) {
      merged.set(row.row_no, row);
    }
  }
  return [...merged.values()].sort((a, b) => a.row_no - b.row_no);
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
