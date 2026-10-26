import { ImportEntityType, ImportRowAction } from '@prisma/client';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { ImportApplyInput } from './import-type-handler.js';
import { VehiclePartyImportHandler } from './vehicle-party-import.handler.js';

describe('VehiclePartyImportHandler apply row order', () => {
  it('keeps file order during background apply batches', async () => {
    const run = jest.fn(
      async (
        _input: ImportApplyInput,
        _entityType: ImportEntityType,
      ): Promise<SerializedImportJob> =>
        ({ status: 'APPLYING', totals: {} }) as SerializedImportJob,
    );
    const handler = new VehiclePartyImportHandler(
      {} as never,
      {} as never,
      { run } as never,
    );
    const rows = [
      {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'a',
        normalized_json: {},
      },
      {
        row_no: 2,
        action: ImportRowAction.UPDATE,
        entity_id: 'party-1',
        external_id: 'a',
        normalized_json: {},
      },
    ];
    await handler.apply({
      tenantId: 'tenant-1',
      job: {
        id: 'job-1',
        source_system: 'legacy',
        options_json: {},
      },
      rows,
      actorUserId: 'user-1',
      effectiveOptions: {},
      preparation: { vendor: null },
      batchOptions: { stopAfterBatch: true, leaseToken: 'lease-1' },
    });
    const appliedRows = run.mock.calls[0]?.[0]?.rows as
      | Array<{ row_no: number }>
      | undefined;
    expect(appliedRows?.map((row) => row.row_no)).toEqual([2, 1]);
    expect(run.mock.calls[0]?.[1]).toBe(ImportEntityType.VEHICLE_PARTY);
  });

  it('still applies updates before creates for synchronous apply', async () => {
    const run = jest.fn(
      async (
        _input: ImportApplyInput,
        _entityType: ImportEntityType,
      ): Promise<SerializedImportJob> =>
        ({ status: 'APPLIED', totals: {} }) as SerializedImportJob,
    );
    const handler = new VehiclePartyImportHandler(
      {} as never,
      {} as never,
      { run } as never,
    );
    const rows = [
      {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'a',
        normalized_json: {},
      },
      {
        row_no: 2,
        action: ImportRowAction.UPDATE,
        entity_id: 'party-1',
        external_id: 'a',
        normalized_json: {},
      },
    ];
    await handler.apply({
      tenantId: 'tenant-1',
      job: {
        id: 'job-1',
        source_system: 'legacy',
        options_json: {},
      },
      rows,
      actorUserId: 'user-1',
      effectiveOptions: {},
      preparation: { vendor: null },
    });
    const appliedRows = run.mock.calls[0]?.[0]?.rows as
      | Array<{ row_no: number }>
      | undefined;
    expect(appliedRows?.map((row) => row.row_no)).toEqual([2, 1]);
  });
});
