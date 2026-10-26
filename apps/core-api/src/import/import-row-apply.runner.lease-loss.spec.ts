import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';

describe('RowByRowApplyRunner lease loss', () => {
  it('rethrows lease loss without marking the plan row as ERROR', async () => {
    const rowUpdate = jest.fn();
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async () => {
        throw new ImportWorkerLeaseLostError();
      },
      importJob: {
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      importJobRow: { update: rowUpdate },
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) => ({ ...job, totals, status: job.status }),
    );
    await expect(
      runner.run(
        {
          tenantId: 'tenant-1',
          job: {
            id: 'job-1',
            source_system: 'legacy',
            options_json: {},
            totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
          },
          rows: [
            {
              row_no: 1,
              action: ImportRowAction.CREATE,
              entity_id: null,
              external_id: 'a',
              normalized_json: { external_id: 'a' },
            },
          ],
          actorUserId: 'user-1',
          effectiveOptions: {},
          preparation: { vendor: null },
        },
        ImportEntityType.CUSTOMER,
        async () => undefined,
        { stopAfterBatch: true, leaseToken: 'lease-a' },
      ),
    ).rejects.toBeInstanceOf(ImportWorkerLeaseLostError);
    expect(rowUpdate).not.toHaveBeenCalled();
  });
});
