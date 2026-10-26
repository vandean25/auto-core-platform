import { ImportRowAction, VehiclePartyRole } from '@prisma/client';
import { IMPORT_APPLY_BATCH_SIZE } from './import.constants.js';
import {
  buildVehiclePartyBackgroundApplyRows,
  orderVehiclePartyApplyRows,
  vehiclePartyVehicleId,
} from './vehicle-party-import.batch-rows.js';
import type { ImportApplyRow } from './import-type-handler.js';

const VEHICLE_ID = 'veh-tenant-uuid-1';

function plannedRow(
  rowNo: number,
  action: ImportRowAction,
  overrides: Record<string, unknown> = {},
): ImportApplyRow {
  return {
    row_no: rowNo,
    action,
    entity_id: action === ImportRowAction.UPDATE ? `party-${rowNo}` : null,
    external_id: `ext-${rowNo}`,
    normalized_json: {
      external_id: `ext-${rowNo}`,
      vehicle_id: VEHICLE_ID,
      customer_id: 'cust-1',
      role: VehiclePartyRole.OWNER,
      valid_from: '2026-01-01',
      valid_to: null,
      notes: null,
      ...overrides,
    },
  };
}

describe('vehicle party batch rows', () => {
  it('reads vehicle_id from the persisted planned payload', () => {
    const row = plannedRow(1, ImportRowAction.CREATE);
    expect(vehiclePartyVehicleId(row)).toBe(VEHICLE_ID);
    expect(
      vehiclePartyVehicleId({
        ...row,
        normalized_json: { vehicle_external_id: 'VEH-1' },
      }),
    ).toBeUndefined();
  });

  it('merges a peeked closing update when the file batch ends with a new owner', () => {
    const fileBatch = Array.from({ length: IMPORT_APPLY_BATCH_SIZE }, (_, index) =>
      plannedRow(index + 1, ImportRowAction.SKIP),
    );
    fileBatch[IMPORT_APPLY_BATCH_SIZE - 1] = plannedRow(
      IMPORT_APPLY_BATCH_SIZE,
      ImportRowAction.CREATE,
    );
    const lookahead = [
      plannedRow(IMPORT_APPLY_BATCH_SIZE + 1, ImportRowAction.UPDATE),
    ];
    const ordered = buildVehiclePartyBackgroundApplyRows(fileBatch, lookahead);
    expect(ordered).toHaveLength(IMPORT_APPLY_BATCH_SIZE + 1);
    expect(ordered[0]?.row_no).toBe(IMPORT_APPLY_BATCH_SIZE + 1);
    expect(ordered.at(-1)?.row_no).toBe(IMPORT_APPLY_BATCH_SIZE);
    expect(ordered.at(-1)?.action).toBe(ImportRowAction.CREATE);
  });

  it('orders in-page updates before creates on the same vehicle', () => {
    const rows = [
      plannedRow(2, ImportRowAction.CREATE),
      plannedRow(1, ImportRowAction.UPDATE),
    ];
    expect(orderVehiclePartyApplyRows(rows).map((row) => row.row_no)).toEqual([
      1,
      2,
    ]);
  });

  it('merges every closing update in the lookahead window for the same vehicle', () => {
    const fileBatch = Array.from({ length: IMPORT_APPLY_BATCH_SIZE }, (_, index) =>
      plannedRow(index + 1, ImportRowAction.SKIP),
    );
    fileBatch[IMPORT_APPLY_BATCH_SIZE - 1] = plannedRow(
      IMPORT_APPLY_BATCH_SIZE,
      ImportRowAction.CREATE,
    );
    const lookahead = [
      plannedRow(IMPORT_APPLY_BATCH_SIZE + 1, ImportRowAction.SKIP),
      plannedRow(IMPORT_APPLY_BATCH_SIZE + 2, ImportRowAction.UPDATE, {
        entity_id: 'party-close-a',
      }),
      plannedRow(IMPORT_APPLY_BATCH_SIZE + 3, ImportRowAction.UPDATE, {
        entity_id: 'party-close-b',
      }),
    ];
    const ordered = buildVehiclePartyBackgroundApplyRows(fileBatch, lookahead);
    const updateRows = ordered.filter(
      (row) => row.action === ImportRowAction.UPDATE,
    );
    expect(updateRows.map((row) => row.row_no)).toEqual([
      IMPORT_APPLY_BATCH_SIZE + 2,
      IMPORT_APPLY_BATCH_SIZE + 3,
    ]);
    expect(ordered.map((row) => row.row_no)).toContain(IMPORT_APPLY_BATCH_SIZE + 1);
    expect(
      ordered.find((row) => row.action === ImportRowAction.CREATE && row.row_no === IMPORT_APPLY_BATCH_SIZE)
        ?.row_no,
    ).toBe(IMPORT_APPLY_BATCH_SIZE);
    expect(
      ordered.findIndex((row) => row.row_no === IMPORT_APPLY_BATCH_SIZE + 2),
    ).toBeLessThan(
      ordered.findIndex((row) => row.row_no === IMPORT_APPLY_BATCH_SIZE),
    );
  });

  it('includes gap rows in lookahead but not rows past the merged closing update', () => {
    const fileBatch = Array.from({ length: IMPORT_APPLY_BATCH_SIZE }, (_, index) =>
      plannedRow(index + 1, ImportRowAction.SKIP),
    );
    fileBatch[IMPORT_APPLY_BATCH_SIZE - 1] = plannedRow(
      IMPORT_APPLY_BATCH_SIZE,
      ImportRowAction.CREATE,
    );
    const lookahead = [
      plannedRow(IMPORT_APPLY_BATCH_SIZE + 1, ImportRowAction.SKIP),
      plannedRow(IMPORT_APPLY_BATCH_SIZE + 2, ImportRowAction.UPDATE),
      plannedRow(IMPORT_APPLY_BATCH_SIZE + 3, ImportRowAction.SKIP),
    ];
    const ordered = buildVehiclePartyBackgroundApplyRows(fileBatch, lookahead);
    const rowNos = ordered.map((row) => row.row_no);
    expect(rowNos).toContain(IMPORT_APPLY_BATCH_SIZE + 1);
    expect(rowNos).not.toContain(IMPORT_APPLY_BATCH_SIZE + 3);
  });
});
