import { ConflictException } from '@nestjs/common';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { ImportApplyRow } from './import-type-handler.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { VEHICLE_PARTY_RULE_CODES } from '../vehicle/vehicle-party.rules.js';

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function buildRows(): ImportApplyRow[] {
  return [
    {
      row_no: 1,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ext-1',
      normalized_json: { external_id: 'ext-1' },
    },
    {
      row_no: 2,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ext-2',
      normalized_json: { external_id: 'ext-2' },
    },
    {
      row_no: 3,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ext-3',
      normalized_json: { external_id: 'ext-3' },
    },
  ];
}

function buildWriteRow(p2034Attempts: { count: number }) {
  return async (_tx: unknown, row: ImportApplyRow) => {
    if (row.row_no === 1) {
      p2034Attempts.count += 1;
      if (p2034Attempts.count <= 2) {
        throw p2034();
      }
      return;
    }
    if (row.row_no === 2) {
      throw new ConflictException({
        code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
        message: 'overlap',
      });
    }
  };
}

function createPrisma(rowUpdates: unknown[], worker?: ImportJobWorkerState) {
  const tx = {
    externalIdMapping: { findFirst: async () => null },
    importJobRow: { findFirst: async () => null },
    importJob: {
      findFirst: async () => ({
        id: 'job-parity',
        tenant_id: 'tenant-1',
        status: ImportJobStatus.APPLYING,
        options_json: worker ? { worker } : {},
      }),
      update: async () => ({}),
    },
  };
  return {
    externalIdMapping: { findFirst: async () => null },
    importJobRow: {
      findFirst: async () => null,
      update: jest.fn(async (args: { data: unknown }) => {
        rowUpdates.push(args.data);
      }),
    },
    $transaction: async (fn: (client: typeof tx) => Promise<void>) => {
      await fn(tx);
    },
    importJob: {
      update: jest.fn(async () => ({
        id: 'job-parity',
        status: ImportJobStatus.APPLIED,
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => ({
        id: 'job-parity',
        status: ImportJobStatus.APPLIED,
      })),
    },
  };
}

describe('RowByRowApplyRunner sync and background parity', () => {
  const baseInput = {
    tenantId: 'tenant-1',
    job: {
      id: 'job-parity',
      source_system: 'legacy',
      options_json: {},
      totals_json: { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
    },
    actorUserId: 'user-1',
    effectiveOptions: {},
    preparation: { vendor: null },
  };

  async function runPath(
    mode: 'sync' | 'background',
    p2034Attempts: { count: number },
  ) {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-parity',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const rowUpdates: unknown[] = [];
    const prisma = createPrisma(rowUpdates, worker);
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({
          ...job,
          totals,
          status: ImportJobStatus.APPLIED,
        }) as unknown as SerializedImportJob,
    );
    const result = await runner.run(
      {
        ...baseInput,
        job: {
          ...baseInput.job,
          options_json: mode === 'background' ? { worker } : {},
        },
        rows: buildRows(),
      },
      ImportEntityType.CUSTOMER,
      buildWriteRow(p2034Attempts),
      mode === 'background'
        ? {
            stopAfterBatch: true,
            leaseToken: worker.lease_token,
            resumeAfterApplySeq: 0,
            hasMoreRowsAfterBatch: false,
          }
        : undefined,
    );
    return {
      totals: result.totals,
      rowErrors: rowUpdates.map(
        (row) => (row as { errors_json?: unknown }).errors_json,
      ),
    };
  }

  it('matches totals and row errors between sync and background apply', async () => {
    const syncAttempts = { count: 0 };
    const backgroundAttempts = { count: 0 };
    const sync = await runPath('sync', syncAttempts);
    const background = await runPath('background', backgroundAttempts);

    expect(sync.totals).toEqual(background.totals);
    expect(sync.rowErrors).toEqual(background.rowErrors);
    expect(sync.totals).toEqual({
      rows: 3,
      create: 2,
      update: 0,
      skip: 0,
      error: 1,
    });
    expect(sync.rowErrors).toEqual([
      [{ code: VEHICLE_PARTY_RULE_CODES.OVERLAP, message: 'overlap' }],
    ]);
  });
});
