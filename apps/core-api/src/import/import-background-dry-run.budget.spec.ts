import { ImportRowAction } from '@prisma/client';
import { takeDryRunRowsWithinBudget } from './import-background-dry-run.budget.js';

describe('takeDryRunRowsWithinBudget', () => {
  const planned = [
    {
      row_no: 0,
      action: ImportRowAction.CREATE,
      external_id: 'A',
      entity_id: null,
      errors: [],
      warnings: [],
      normalized: {},
    },
    {
      row_no: 0,
      action: ImportRowAction.CREATE,
      external_id: 'B',
      entity_id: null,
      errors: [],
      warnings: [],
      normalized: {},
    },
    {
      row_no: 0,
      action: ImportRowAction.CREATE,
      external_id: 'C',
      entity_id: null,
      errors: [],
      warnings: [],
      normalized: {},
    },
  ];

  it('persists a prefix when the chunk budget is exceeded mid-batch', () => {
    let now = 0;
    const rows = takeDryRunRowsWithinBudget(planned, 10, 3, () => {
      now += 1;
      return now;
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.row_no).toBe(11);
    expect(rows[1]?.row_no).toBe(12);
  });
});
