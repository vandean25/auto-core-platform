import { ImportRowAction } from '@prisma/client';
import {
  dryRunRowUpdatePayload,
  persistGroupedDryRunRowUpdates,
} from './import-dry-run-reconcile.persist-rows.js';

describe('persistGroupedDryRunRowUpdates', () => {
  it('groups rows with identical update payloads into one updateMany', async () => {
    const updateMany = jest.fn(async () => ({ count: 2 }));
    const tx = { importJobRow: { updateMany } };
    const normalized = { external_id: 'shared' };
    const rows = [
      {
        row_no: 1,
        external_id: 'shared',
        action: ImportRowAction.CREATE,
        entity_id: null,
        errors: [],
        warnings: [],
        normalized,
      },
      {
        row_no: 2,
        external_id: 'shared',
        action: ImportRowAction.CREATE,
        entity_id: null,
        errors: [],
        warnings: [],
        normalized,
      },
    ];

    await persistGroupedDryRunRowUpdates(
      tx as never,
      'tenant-1',
      'job-1',
      rows,
    );

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        import_job_id: 'job-1',
        row_no: { in: [1, 2] },
      },
      data: dryRunRowUpdatePayload(rows[0]),
    });
  });

  it('uses separate updateMany calls when payloads differ', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const tx = { importJobRow: { updateMany } };
    await persistGroupedDryRunRowUpdates(tx as never, 'tenant-1', 'job-1', [
      {
        row_no: 1,
        external_id: 'a',
        action: ImportRowAction.CREATE,
        entity_id: null,
        errors: [],
        warnings: [],
        normalized: { external_id: 'a' },
      },
      {
        row_no: 2,
        external_id: 'b',
        action: ImportRowAction.ERROR,
        entity_id: null,
        errors: [{ code: 'X', message: 'bad' }],
        warnings: [],
        normalized: null,
      },
    ]);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
