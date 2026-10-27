import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { assignVehiclePartyApplySeqs } from './import-apply-sequence.test-util.js';
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

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function buildFixtureRows(): ImportApplyRow[] {
  return [
    {
      row_no: 1,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ext-retry',
      normalized_json: { external_id: 'ext-retry' },
    },
    {
      row_no: 2,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ext-overlap',
      normalized_json: {
        external_id: 'ext-overlap',
        vehicle_id: 'veh-1',
        customer_id: 'cust-1',
        role: 'OWNER',
        valid_from: '2026-01-01',
        valid_to: null,
        notes: null,
      },
    },
    {
      row_no: 3,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ext-invalid',
      normalized_json: {
        external_id: 'ext-invalid',
        vehicle_id: 'veh-1',
        customer_id: 'cust-1',
        role: 'OWNER',
        valid_from: 'bad',
        valid_to: null,
        notes: null,
      },
    },
    {
      row_no: 4,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ext-unique',
      normalized_json: { external_id: 'ext-unique' },
    },
    {
      row_no: 5,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ext-dup-job',
      normalized_json: { external_id: 'ext-dup-job' },
    },
  ];
}

function buildWriteRow(
  p2034Attempts: Map<number, number>,
  overlapRowNo: number,
) {
  return async (_tx: unknown, row: ImportApplyRow) => {
    if (row.row_no === 1) {
      const seen = (p2034Attempts.get(1) ?? 0) + 1;
      p2034Attempts.set(1, seen);
      if (seen <= 2) {
        throw p2034();
      }
      return;
    }
    if (row.row_no === overlapRowNo) {
      throw new ConflictException({
        code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
        message: 'overlap',
      });
    }
    if (row.row_no === 3) {
      throw new UnprocessableEntityException({
        code: VEHICLE_PARTY_RULE_CODES.INTERVAL_INVALID,
        message: 'invalid',
      });
    }
    if (row.row_no === 4) {
      throw p2002();
    }
  };
}

function createSequencePrisma(
  rowUpdates: Array<{ row_no: number; data: unknown }>,
  worker: ImportJobWorkerState,
  rows: ImportApplyRow[],
) {
  const maxApplySeq = rows.reduce(
    (max, row) => Math.max(max, row.apply_seq ?? 0),
    0,
  );
  const jobTotals = {
    rows: 5,
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
  };
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  const tx = {
    importJob: {
      findFirst: async () => ({
        id: 'job-parity',
        tenant_id: 'tenant-1',
        status: jobStatus,
        totals_json: { ...jobTotals },
        options_json: { worker },
      }),
      update: async (args: {
        data: {
          status?: ImportJobStatus;
          options_json?: { worker: ImportJobWorkerState };
          totals_json?: typeof jobTotals;
        };
      }) => {
        if (args.data.options_json?.worker) {
          Object.assign(worker, args.data.options_json.worker);
        }
        if (args.data.totals_json) {
          Object.assign(jobTotals, args.data.totals_json);
        }
        if (args.data.status === ImportJobStatus.APPLIED) {
          jobStatus = ImportJobStatus.APPLIED;
        }
      },
    },
    importJobRow: {
      findFirst: async ({
        where,
      }: {
        where: { row_no?: number; external_id?: string };
      }) => {
        if (where.external_id === 'ext-dup-job') {
          return { row_no: 4 };
        }
        return null;
      },
      update: jest.fn(
        async (args: {
          where: {
            row_no?: number;
            tenant_id_import_job_id_row_no?: { row_no: number };
          };
          data: unknown;
        }) => {
          const rowNo =
            args.where.row_no ??
            args.where.tenant_id_import_job_id_row_no?.row_no;
          if (rowNo === undefined) {
            throw new Error('importJobRow.update mock missing row_no');
          }
          rowUpdates.push({ row_no: rowNo, data: args.data });
        },
      ),
      count: jest.fn(
        async (args?: { where?: { action?: ImportRowAction } }) => {
          if (args?.where?.action === ImportRowAction.ERROR) {
            return jobTotals.error;
          }
          if (args?.where?.action === ImportRowAction.CREATE) {
            return 5;
          }
          return 5;
        },
      ),
    },
    externalIdMapping: {
      findFirst: async ({ where }: { where: { external_id?: string } }) => {
        if (where.external_id === 'ext-dup-job') {
          return { first_seen_import_job_id: 'job-parity' };
        }
        return null;
      },
    },
  };
  return {
    externalIdMapping: {
      findFirst: async ({ where }: { where: { external_id?: string } }) => {
        if (where.external_id === 'ext-dup-job') {
          return { first_seen_import_job_id: 'job-parity' };
        }
        return null;
      },
    },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    importJob: {
      updateMany: jest.fn(),
      findFirst: async () => ({
        id: 'job-parity',
        status: jobStatus,
        totals_json: { ...jobTotals },
        options_json: { worker },
      }),
      update: jest.fn(),
    },
    importJobRow: {
      findFirst: async ({
        where,
      }: {
        where: { row_no?: number; external_id?: string };
      }) => {
        if (where.external_id === 'ext-dup-job') {
          return { row_no: 4 };
        }
        return null;
      },
      update: jest.fn(
        async (args: {
          where: {
            row_no?: number;
            tenant_id_import_job_id_row_no?: { row_no: number };
          };
          data: unknown;
        }) => {
          const rowNo =
            args.where.row_no ??
            args.where.tenant_id_import_job_id_row_no?.row_no;
          if (rowNo === undefined) {
            throw new Error('importJobRow.update mock missing row_no');
          }
          rowUpdates.push({ row_no: rowNo, data: args.data });
        },
      ),
      count: jest.fn(async () => 5),
    },
    maxApplySeq,
  };
}

function createSyncPrisma(
  rowUpdates: Array<{ row_no: number; data: unknown }>,
) {
  const tx = {
    externalIdMapping: {
      findFirst: async ({ where }: { where: { external_id?: string } }) => {
        if (where.external_id === 'ext-dup-job') {
          return { first_seen_import_job_id: 'job-parity' };
        }
        return null;
      },
    },
    importJobRow: {
      findFirst: async ({
        where,
      }: {
        where: { row_no?: number; external_id?: string };
      }) => {
        if (where.external_id === 'ext-dup-job') {
          return { row_no: 4 };
        }
        return null;
      },
      count: jest.fn(async () => 5),
    },
  };
  return {
    externalIdMapping: {
      findFirst: async ({ where }: { where: { external_id?: string } }) => {
        if (where.external_id === 'ext-dup-job') {
          return { first_seen_import_job_id: 'job-parity' };
        }
        return null;
      },
    },
    importJobRow: {
      findFirst: async ({
        where,
      }: {
        where: { row_no?: number; external_id?: string };
      }) => {
        if (where.external_id === 'ext-dup-job') {
          return { row_no: 4 };
        }
        return null;
      },
      update: jest.fn(
        async (args: {
          where: {
            row_no?: number;
            tenant_id_import_job_id_row_no?: { row_no: number };
          };
          data: unknown;
        }) => {
          const rowNo =
            args.where.row_no ??
            args.where.tenant_id_import_job_id_row_no?.row_no;
          if (rowNo === undefined) {
            throw new Error('importJobRow.update mock missing row_no');
          }
          rowUpdates.push({ row_no: rowNo, data: args.data });
        },
      ),
      count: jest.fn(async () => 5),
    },
    $transaction: async (fn: (client: typeof tx) => Promise<void>) => {
      await fn(tx);
    },
    importJob: {
      update: jest.fn(async () => ({
        id: 'job-parity',
        status: ImportJobStatus.APPLIED,
      })),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

describe('RowByRowApplyRunner sync and background parity', () => {
  const baseJob = {
    id: 'job-parity',
    source_system: 'legacy',
    options_json: {},
    totals_json: { rows: 5, create: 0, update: 0, skip: 0, error: 0 },
  };

  function summarize(
    result: SerializedImportJob,
    rowUpdates: Array<{ row_no: number; data: unknown }>,
  ) {
    const errorsByRow = new Map(
      rowUpdates.map((entry) => [
        entry.row_no,
        (entry.data as { errors_json?: unknown }).errors_json,
      ]),
    );
    return {
      totals: result.totals,
      rowErrors: [1, 2, 3, 4, 5].map((rowNo) => errorsByRow.get(rowNo)),
    };
  }

  async function runSync(p2034Attempts: Map<number, number>) {
    const rowUpdates: Array<{ row_no: number; data: unknown }> = [];
    const prisma = createSyncPrisma(rowUpdates);
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
    const rows = buildFixtureRows();
    const result = await runner.run(
      {
        tenantId: 'tenant-1',
        job: baseJob,
        rows,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.VEHICLE_PARTY,
      buildWriteRow(p2034Attempts, 2),
    );
    return summarize(result, rowUpdates);
  }

  async function runBackground(p2034Attempts: Map<number, number>) {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-parity',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const rows = assignVehiclePartyApplySeqs(buildFixtureRows());
    const rowUpdates: Array<{ row_no: number; data: unknown }> = [];
    const prisma = createSequencePrisma(rowUpdates, worker, rows);
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
        tenantId: 'tenant-1',
        job: { ...baseJob, options_json: { worker } },
        rows,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.VEHICLE_PARTY,
      buildWriteRow(p2034Attempts, 2),
      {
        stopAfterBatch: true,
        useApplySequence: true,
        maxApplySeq: prisma.maxApplySeq,
        leaseToken: worker.lease_token,
        hasMoreRowsAfterBatch: false,
      },
    );
    return summarize(result, rowUpdates);
  }

  it('matches row actions, errors_json, and totals on sync and sequence background apply', async () => {
    const syncAttempts = new Map<number, number>();
    const backgroundAttempts = new Map<number, number>();
    const sync = await runSync(syncAttempts);
    const background = await runBackground(backgroundAttempts);

    expect(sync).toEqual(background);
    expect(sync.totals).toEqual({
      rows: 5,
      create: 1,
      update: 0,
      skip: 0,
      error: 4,
    });
    expect(sync.rowErrors[1]).toEqual([
      { code: VEHICLE_PARTY_RULE_CODES.OVERLAP, message: 'overlap' },
    ]);
    expect(sync.rowErrors[2]).toEqual([
      { code: VEHICLE_PARTY_RULE_CODES.INTERVAL_INVALID, message: 'invalid' },
    ]);
    expect(sync.rowErrors[3]).toEqual([
      { code: 'IMPORT_APPLY_FAILED', message: 'Row failed during apply' },
    ]);
    expect(sync.rowErrors[4]).toEqual([
      {
        code: 'IMPORT_DUPLICATE_EXTERNAL_ID_IN_FILE',
        message: expect.any(String),
      },
    ]);
  });
});
