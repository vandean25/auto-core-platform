import { ImportEntityType } from '@prisma/client';
import { computeImportDryRunReconcileUnits } from './import-dry-run-reconcile.units.js';

describe('computeImportDryRunReconcileUnits (key components)', () => {
  function prismaWithRows(
    rows: Array<{
      row_no: number;
      external_id: string | null;
      normalized_json?: unknown;
    }>,
  ) {
    return {
      importJobRow: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
  }

  it('links rows that share any active reconcile key', async () => {
    const prisma = prismaWithRows([
      {
        row_no: 1,
        external_id: 'shared-ext',
        normalized_json: { email: 'a@example.com' },
      },
      {
        row_no: 600,
        external_id: 'other',
        normalized_json: { email: 'a@example.com' },
      },
      {
        row_no: 601,
        external_id: 'shared-ext',
        normalized_json: {},
      },
    ]);
    const units = await computeImportDryRunReconcileUnits(prisma as never, {
      tenantId: 't',
      jobId: 'j',
      entityType: ImportEntityType.CUSTOMER,
      batchSize: 500,
    });
    expect(units).toHaveLength(1);
    expect(units[0].replan_row_nos.sort()).toEqual([1, 600, 601]);
  });

  it('keeps independent cross-batch keys in separate units', async () => {
    const last = 40;
    const rows = Array.from({ length: last }, (_, index) => {
      const rowNo = index + 1;
      let external_id = `solo-${rowNo}`;
      if (rowNo === 1 || rowNo === last) {
        external_id = 'pair-a';
      }
      if (rowNo === 2 || rowNo === last - 1) {
        external_id = 'pair-b';
      }
      return { row_no: rowNo, external_id, normalized_json: {} };
    });
    const prisma = prismaWithRows(rows);
    const units = await computeImportDryRunReconcileUnits(prisma as never, {
      tenantId: 't',
      jobId: 'j',
      entityType: ImportEntityType.CUSTOMER,
      batchSize: 10,
    });
    expect(units).toHaveLength(2);
    const replan = units.map((unit) => unit.replan_row_nos.sort());
    expect(replan).toEqual(expect.arrayContaining([[1, last], [2, last - 1]]));
    for (const unit of units) {
      expect(unit.replan_row_nos.length).toBe(2);
    }
  });
});
