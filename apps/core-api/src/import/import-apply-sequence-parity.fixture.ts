import { ImportRowAction, VehiclePartyRole } from '@prisma/client';
import type { ImportApplyRow } from './import-type-handler.js';

const VEHICLE_ID = 'veh-parity';

/** 60 rows: dense UPDATE block, gap CREATE at 51, creates across page boundary (batch 50). */
export function buildVehiclePartySixtyRowFixture(): ImportApplyRow[] {
  const rows: ImportApplyRow[] = [];
  for (let rowNo = 1; rowNo <= 60; rowNo += 1) {
    let action: ImportRowAction = ImportRowAction.UPDATE;
    if (rowNo === 51) {
      action = ImportRowAction.CREATE;
    } else if (rowNo >= 52 && rowNo <= 55) {
      action = ImportRowAction.CREATE;
    } else if (rowNo > 55) {
      action =
        rowNo % 2 === 0 ? ImportRowAction.CREATE : ImportRowAction.UPDATE;
    }
    rows.push({
      row_no: rowNo,
      action,
      entity_id: action === ImportRowAction.UPDATE ? `party-${rowNo}` : null,
      external_id: `ext-${rowNo}`,
      normalized_json: {
        external_id: `ext-${rowNo}`,
        vehicle_id: rowNo === 49 ? 'veh-other' : VEHICLE_ID,
        customer_id: `cust-${rowNo % 5}`,
        role: VehiclePartyRole.OWNER,
        valid_from: '2026-01-01',
        valid_to: action === ImportRowAction.UPDATE ? '2026-06-01' : null,
        notes: null,
      },
    });
  }
  return rows;
}
