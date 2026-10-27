import { ImportRowAction } from '@prisma/client';
import {
  planParsedCsvRowsWithBudget,
  shouldStopDryRunPlanningAfterRow,
} from './import-dry-run-plan-budget.js';

describe('import dry-run plan budget', () => {
  const parsed = {
    headers: ['id'],
    rows: [['a'], ['b'], ['c'], ['d']],
  };

  it('always plans at least one row before stopping on deadline', () => {
    let now = 100;
    const rows = planParsedCsvRowsWithBudget(
      parsed,
      {
        deadlineMs: 50,
        rowNoOffset: 11,
        nowMs: () => now,
        onAfterRowPlanned: () => {
          now += 10;
        },
      },
      (rowNo) => ({
        row_no: rowNo,
        action: ImportRowAction.CREATE,
        external_id: String(rowNo),
        entity_id: null,
        errors: [],
        warnings: [],
        normalized: {},
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.row_no).toBe(11);
  });

  it('stops mid-chunk once the deadline passes after the first row', () => {
    let now = 0;
    const rows = planParsedCsvRowsWithBudget(
      parsed,
      {
        deadlineMs: 75,
        rowNoOffset: 1,
        nowMs: () => now,
        onAfterRowPlanned: () => {
          now += 40;
        },
      },
      (rowNo) => ({
        row_no: rowNo,
        action: ImportRowAction.CREATE,
        external_id: String(rowNo),
        entity_id: null,
        errors: [],
        warnings: [],
        normalized: {},
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.row_no)).toEqual([1, 2]);
    expect(
      shouldStopDryRunPlanningAfterRow(
        { deadlineMs: 75, rowNoOffset: 1, nowMs: () => now },
        2,
      ),
    ).toBe(true);
  });
});
