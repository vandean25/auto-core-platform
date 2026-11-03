import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { resolveDuplicateCommittedCreateLegacy } from './import-apply-duplicate-create.js';

describe('duplicate CREATE in the same import job', () => {
  const input = {
    tenantId: 'tenant-1',
    job: { id: 'job-1', source_system: 'legacy', options_json: {} },
    rows: [],
    actorUserId: 'actor',
    effectiveOptions: {},
    preparation: { vendor: null },
  };

  function committedTx(earliestCommittedRowNo: number) {
    return {
      externalIdMapping: {
        findFirst: jest.fn().mockResolvedValue({
          first_seen_import_job_id: 'job-1',
        }),
      },
      importJobRow: {
        findFirst: jest.fn().mockResolvedValue({
          row_no: earliestCommittedRowNo,
        }),
      },
    };
  }

  const createRow = (rowNo: number) => ({
    row_no: rowNo,
    action: ImportRowAction.CREATE,
    entity_id: null,
    external_id: 'dup-ext',
    normalized_json: { external_id: 'dup-ext' },
  });

  it('noops when the same row retries after the external id was already committed', async () => {
    const outcome = await resolveDuplicateCommittedCreateLegacy(
      committedTx(1) as never,
      input,
      ImportEntityType.CUSTOMER,
      createRow(1),
    );
    expect(outcome).toBe('noop');
  });

  it('resolves a duplicate error when another row already committed the external id', async () => {
    const outcome = await resolveDuplicateCommittedCreateLegacy(
      committedTx(1) as never,
      input,
      ImportEntityType.CUSTOMER,
      createRow(2),
    );
    expect(outcome).toBe('duplicate_error');
  });
});
