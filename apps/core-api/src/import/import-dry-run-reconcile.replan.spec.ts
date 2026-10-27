import { ImportRowAction } from '@prisma/client';
import {
  computeReconcileTargetCursor,
  pickReconcileTargets,
} from './import-dry-run-reconcile.replan.js';
import type { ImportDryRunReconcileUnit } from './import-job.worker-state.js';
import type { DryRunRowResult } from './import.types.js';

describe('computeReconcileTargetCursor', () => {
  const unit: ImportDryRunReconcileUnit = {
    context_from_row: 1,
    context_to_row: 4,
    replan_row_nos: [1, 2, 3, 4],
  };

  it('stays when the first selected target did not get a planned row', () => {
    expect(computeReconcileTargetCursor(unit, 0, 1, [])).toBe(0);
    expect(computeReconcileTargetCursor(unit, 0, 2, [row(2)])).toBe(0);
  });

  it('advances through settled targets but stops at the first unsettled selection', () => {
    expect(computeReconcileTargetCursor(unit, 0, 2, [row(1)])).toBe(1);
  });

  it('advances only through contiguous planned targets', () => {
    const planned = [row(1), row(2), row(3)];
    expect(computeReconcileTargetCursor(unit, 0, 4, planned)).toBe(3);
    expect(computeReconcileTargetCursor(unit, 2, 4, planned)).toBe(3);
  });
});

describe('pickReconcileTargets', () => {
  it('never selects more than batchSize targets for a long unit', () => {
    const largeUnit: ImportDryRunReconcileUnit = {
      context_from_row: 1,
      context_to_row: 6,
      replan_row_nos: [1, 2, 3, 4, 5, 6],
    };
    const { targets } = pickReconcileTargets(
      largeUnit,
      0,
      2,
      Date.now() + 60_000,
    );
    expect(targets).toEqual([1, 2]);
    const next = pickReconcileTargets(largeUnit, 2, 2, Date.now() + 60_000);
    expect(next.targets).toEqual([3, 4]);
  });
});

function row(rowNo: number): DryRunRowResult {
  return {
    row_no: rowNo,
    external_id: `ext-${rowNo}`,
    action: ImportRowAction.CREATE,
    entity_id: null,
    errors: [],
    warnings: [],
    normalized: {},
  };
}
