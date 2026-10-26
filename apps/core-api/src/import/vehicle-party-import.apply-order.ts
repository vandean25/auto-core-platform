import { ImportRowAction } from '@prisma/client';
import type { ImportApplyRow } from './import-type-handler.js';

/** Same ordering as synchronous vehicle-party apply (updates first, then by row_no). */
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
