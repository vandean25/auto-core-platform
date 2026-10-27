import { ImportRowAction } from '@prisma/client';
import { replanImportDryRunUnit } from './import-dry-run-reconcile.plan-unit.js';
import { IMPORT_RECONCILE_GROUP_MAX_ROWS } from './import-dry-run-group-limit.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';

describe('replanImportDryRunUnit', () => {
  it('marks every row IMPORT_GROUP_TOO_LARGE when the unit exceeds the cap without planning', async () => {
    const rowNos = Array.from(
      { length: IMPORT_RECONCILE_GROUP_MAX_ROWS + 1 },
      (_, index) => index + 1,
    );
    const planDryRun = jest.fn();
    const findMany = jest.fn().mockResolvedValue(
      rowNos.map((rowNo) => ({
        row_no: rowNo,
        external_id: `ext-${rowNo}`,
      })),
    );
    const result = await replanImportDryRunUnit({
      prisma: { importJobRow: { findMany } } as never,
      fileStorage: {} as never,
      upload: { object_key: 'imports/test.csv' },
      fileSha256: 'sha',
      tenantId: 't',
      jobId: 'j',
      handler: { planDryRun } as never,
      input: {
        tenantId: 't',
        sourceSystem: 'legacy',
        mapping: {},
        options: {},
      },
      unit: {
        context_from_row: 1,
        context_to_row: rowNos.length,
        replan_row_nos: rowNos,
      },
    });

    expect(planDryRun).not.toHaveBeenCalled();
    expect(result).toHaveLength(IMPORT_RECONCILE_GROUP_MAX_ROWS + 1);
    for (const row of result) {
      expect(row.action).toBe(ImportRowAction.ERROR);
      expect(row.errors[0]?.code).toBe(IMPORT_ERROR_CODES.GROUP_TOO_LARGE);
    }
  });
});
