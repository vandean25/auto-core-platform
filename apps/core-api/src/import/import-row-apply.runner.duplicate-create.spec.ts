import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { ImportDuplicateCreateInJobError } from './import-apply.errors.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';

describe('RowByRowApplyRunner duplicate CREATE in same job', () => {
  it('throws a row-level error when a sibling row already committed the external id', async () => {
    const tx = {
      externalIdMapping: {
        findFirst: jest.fn().mockResolvedValue({
          first_seen_import_job_id: 'job-1',
        }),
      },
      importJobRow: {
        findFirst: jest.fn().mockResolvedValue({ row_no: 1 }),
      },
    };
    const prisma = {} as never;
    const runner = new RowByRowApplyRunner(
      prisma,
      {} as never,
      jest.fn() as never,
    );

    await expect(
      runner['applyRowBodyInTransaction'](
        tx as never,
        {
          tenantId: 'tenant-1',
          job: { id: 'job-1', source_system: 'legacy', options_json: {} },
          rows: [],
          actorUserId: 'actor',
          effectiveOptions: {},
          preparation: { vendor: null },
        },
        ImportEntityType.CUSTOMER,
        jest.fn(),
        {
          row_no: 2,
          action: ImportRowAction.CREATE,
          entity_id: null,
          external_id: 'dup-ext',
          normalized_json: { external_id: 'dup-ext' },
        },
      ),
    ).rejects.toBeInstanceOf(ImportDuplicateCreateInJobError);
  });
});
