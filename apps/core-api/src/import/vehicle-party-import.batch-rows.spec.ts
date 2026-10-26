import { ImportRowAction } from '@prisma/client';
import {
  expandVehiclePartyBatchWithLookahead,
  orderVehiclePartyApplyRows,
} from './vehicle-party-import.batch-rows.js';

describe('vehicle party batch rows', () => {
  it('merges a peeked closing update for a new owner on the same vehicle', () => {
    const batch = [
      {
        row_no: 50,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'party-new',
        normalized_json: { vehicle_external_id: 'VEH-1' },
      },
    ];
    const lookahead = [
      {
        row_no: 51,
        action: ImportRowAction.UPDATE,
        entity_id: 'party-old',
        external_id: 'party-old',
        normalized_json: { vehicle_external_id: 'VEH-1' },
      },
    ];
    const merged = expandVehiclePartyBatchWithLookahead(batch, lookahead);
    expect(merged.map((row) => row.row_no)).toEqual([50, 51]);
    expect(orderVehiclePartyApplyRows(merged).map((row) => row.row_no)).toEqual(
      [51, 50],
    );
  });

  it('ignores lookahead rows for unrelated vehicles', () => {
    const batch = [
      {
        row_no: 2,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'party-new',
        normalized_json: { vehicle_external_id: 'VEH-1' },
      },
    ];
    const lookahead = [
      {
        row_no: 3,
        action: ImportRowAction.UPDATE,
        entity_id: 'party-old',
        external_id: 'party-old',
        normalized_json: { vehicle_external_id: 'VEH-2' },
      },
    ];
    expect(expandVehiclePartyBatchWithLookahead(batch, lookahead)).toEqual(batch);
  });
});
