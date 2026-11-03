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
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { VEHICLE_PARTY_RULE_CODES } from '../vehicle/vehicle-party.rules.js';

type RowUpdate = { row_no: number; data: unknown };

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

/** The runner reports the job as applied; these specs assert on rows and totals. */
function createAppliedRunner(prisma: unknown) {
  return new RowByRowApplyRunner(
    prisma as never,
    { writeImportJobAudit: jest.fn() } as never,
    (job, totals) =>
      ({
        ...job,
        totals,
        status: ImportJobStatus.APPLIED,
      }) as unknown as SerializedImportJob,
  );
}

function customerRow(rowNo: number, externalId: string): ImportApplyRow {
  return {
    row_no: rowNo,
    action: ImportRowAction.CREATE,
    entity_id: null,
    external_id: externalId,
    normalized_json: { external_id: externalId },
  };
}

function vehiclePartyRow(
  rowNo: number,
  externalId: string,
  validFrom: string,
): ImportApplyRow {
  return {
    ...customerRow(rowNo, externalId),
    normalized_json: {
      external_id: externalId,
      vehicle_id: 'veh-1',
      customer_id: 'cust-1',
      role: 'OWNER',
      valid_from: validFrom,
      valid_to: null,
      notes: null,
    },
  };
}

/** One row of the file conflicts at apply time; its neighbours must still land. */
function buildConflictRows(): ImportApplyRow[] {
  return [
    customerRow(1, 'ok-1'),
    vehiclePartyRow(2, 'conflict', '2026-01-01'),
    customerRow(3, 'ok-3'),
  ];
}

async function writeRowWithApplyOverlap(_tx: unknown, row: ImportApplyRow) {
  if (row.row_no === 2) {
    throw new ConflictException({
      code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
      message: 'overlap at apply',
    });
  }
}

function conflictApplyInput(rows: ImportApplyRow[], optionsJson: Prisma.JsonValue) {
  return {
    tenantId: 'tenant-1',
    job: {
      id: 'job-409',
      source_system: 'legacy',
      options_json: optionsJson,
      totals_json: { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
    },
    rows,
    actorUserId: 'user-1',
    effectiveOptions: {},
    preparation: { vendor: null },
  };
}

function recordRowUpdates(rowUpdates: unknown[]) {
  return jest.fn(async (args: { data: unknown }) => {
    rowUpdates.push(args.data);
  });
}

describe('RowByRowApplyRunner row outcomes', () => {
  it('records ERROR on the conflict row and APPLIES on sync legacy apply', async () => {
    const rowUpdates: unknown[] = [];
    const importJobRow = {
      findFirst: async () => null,
      update: recordRowUpdates(rowUpdates),
    };
    const importJob = {
      update: jest.fn(async () => ({
        id: 'job-409',
        status: ImportJobStatus.APPLIED,
      })),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    };
    const tx = withApplyPersistedTotalsTransactionClient(
      {
        externalIdMapping: { findFirst: async () => null },
        importJobRow,
        importJob,
      },
      { expectedRows: 3 },
    );
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      importJobRow,
      $transaction: async (fn: (client: typeof tx) => Promise<void>) => {
        await fn(tx);
      },
      importJob,
    };
    const runner = createAppliedRunner(prisma);

    const result = await runner.run(
      conflictApplyInput(buildConflictRows(), {}),
      ImportEntityType.VEHICLE_PARTY,
      writeRowWithApplyOverlap,
    );

    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(result.totals).toEqual({
      rows: 3,
      create: 2,
      update: 0,
      skip: 0,
      error: 1,
    });
    expect(rowUpdates).toEqual([
      {
        action: ImportRowAction.ERROR,
        errors_json: [
          {
            code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
            message: 'overlap at apply',
          },
        ],
      },
    ]);
  });

  it('records ERROR on the conflict row and APPLIES on sequence background apply', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-409',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const rows = assignVehiclePartyApplySeqs(buildConflictRows());
    const rowUpdates: unknown[] = [];
    const tx = withApplyPersistedTotalsTransactionClient(
      {
        importJob: {
          findFirst: async () => ({
            id: 'job-409',
            tenant_id: 'tenant-1',
            status: ImportJobStatus.APPLYING,
            totals_json: { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
            options_json: { worker },
          }),
          update: async (args: {
            data: { options_json?: { worker: ImportJobWorkerState } };
          }) => {
            if (args.data.options_json?.worker) {
              Object.assign(worker, args.data.options_json.worker);
            }
          },
        },
        importJobRow: {
          findFirst: async () => null,
          update: recordRowUpdates(rowUpdates),
        },
        externalIdMapping: { findFirst: async () => null },
      },
      { expectedRows: 3 },
    );
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      importJob: {
        updateMany: jest.fn(),
        findFirst: async () => ({
          id: 'job-409',
          status: ImportJobStatus.APPLIED,
        }),
        update: jest.fn(),
      },
      importJobRow: {
        update: recordRowUpdates(rowUpdates),
        findFirst: async () => null,
      },
    };
    const runner = createAppliedRunner(prisma);

    const result = await runner.run(
      conflictApplyInput(rows, { worker }),
      ImportEntityType.VEHICLE_PARTY,
      writeRowWithApplyOverlap,
      {
        stopAfterBatch: true,
        useApplySequence: true,
        maxApplySeq: 3,
        leaseToken: worker.lease_token,
        hasMoreRowsAfterBatch: false,
      },
    );

    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(result.totals.error).toBe(1);
    expect(result.totals.create).toBe(2);
    expect(rowUpdates).toContainEqual({
      action: ImportRowAction.ERROR,
      errors_json: [
        { code: VEHICLE_PARTY_RULE_CODES.OVERLAP, message: 'overlap at apply' },
      ],
    });
  });
});

/**
 * Fixture for the sync/background parity check: one row recovers from write conflicts,
 * one overlaps, one is invalid, one collides on a unique index, one repeats an external
 * id already committed by this job.
 */
function buildParityRows(): ImportApplyRow[] {
  return [
    customerRow(1, 'ext-retry'),
    vehiclePartyRow(2, 'ext-overlap', '2026-01-01'),
    vehiclePartyRow(3, 'ext-invalid', 'bad'),
    customerRow(4, 'ext-unique'),
    customerRow(5, 'ext-dup-job'),
  ];
}

const DUPLICATED_IN_JOB_EXTERNAL_ID = 'ext-dup-job';
const DUPLICATED_IN_JOB_ROW_NO = 4;

function externalIdMappingFixture() {
  return {
    findFirst: jest.fn(
      async ({ where }: { where: { external_id?: string } }) =>
        where.external_id === DUPLICATED_IN_JOB_EXTERNAL_ID
          ? { first_seen_import_job_id: 'job-parity' }
          : null,
    ),
  };
}

function rowFindFirst() {
  return jest.fn(
    async ({ where }: { where: { row_no?: number; external_id?: string } }) =>
      where.external_id === DUPLICATED_IN_JOB_EXTERNAL_ID
        ? { row_no: DUPLICATED_IN_JOB_ROW_NO }
        : null,
  );
}

function rowUpdateRecorder(rowUpdates: RowUpdate[]) {
  return jest.fn(
    async (args: {
      where: {
        row_no?: number;
        tenant_id_import_job_id_row_no?: { row_no: number };
      };
      data: unknown;
    }) => {
      const rowNo =
        args.where.row_no ?? args.where.tenant_id_import_job_id_row_no?.row_no;
      if (rowNo === undefined) {
        throw new Error('importJobRow.update mock missing row_no');
      }
      rowUpdates.push({ row_no: rowNo, data: args.data });
    },
  );
}

function buildParityWriteRow(
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

function createBackgroundApplyPrisma(
  rowUpdates: RowUpdate[],
  worker: ImportJobWorkerState,
  rows: ImportApplyRow[],
) {
  const maxApplySeq = rows.reduce(
    (max, row) => Math.max(max, row.apply_seq ?? 0),
    0,
  );
  const jobTotals = { rows: 5, create: 0, update: 0, skip: 0, error: 0 };
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  const importJobRow = {
    findFirst: rowFindFirst(),
    update: rowUpdateRecorder(rowUpdates),
    count: jest.fn(
      async (args?: { where?: { action?: ImportRowAction } }) =>
        args?.where?.action === ImportRowAction.ERROR ? jobTotals.error : 5,
    ),
  };
  const externalIdMapping = externalIdMappingFixture();
  const tx = withApplyPersistedTotalsTransactionClient(
    {
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
      importJobRow,
      externalIdMapping,
    },
    { expectedRows: jobTotals.rows },
  );
  return {
    externalIdMapping,
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
      findFirst: rowFindFirst(),
      update: rowUpdateRecorder(rowUpdates),
      count: jest.fn(async () => 5),
    },
    maxApplySeq,
  };
}

function createSyncApplyPrisma(rowUpdates: RowUpdate[]) {
  const importJobRow = {
    findFirst: rowFindFirst(),
    update: rowUpdateRecorder(rowUpdates),
    count: jest.fn(async () => 5),
  };
  const importJob = {
    update: jest.fn(async () => ({
      id: 'job-parity',
      status: ImportJobStatus.APPLIED,
    })),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
  };
  const tx = withApplyPersistedTotalsTransactionClient(
    {
      externalIdMapping: externalIdMappingFixture(),
      importJobRow: { findFirst: rowFindFirst(), count: jest.fn(async () => 5) },
    },
    { expectedRows: 5 },
  );
  return {
    externalIdMapping: externalIdMappingFixture(),
    importJobRow,
    $transaction: async (fn: (client: typeof tx) => Promise<void>) => {
      await fn({ ...tx, importJob });
    },
    importJob,
  };
}

function parityInput(rows: ImportApplyRow[], optionsJson: Prisma.JsonValue) {
  return {
    tenantId: 'tenant-1',
    job: {
      id: 'job-parity',
      source_system: 'legacy',
      options_json: optionsJson,
      totals_json: { rows: 5, create: 0, update: 0, skip: 0, error: 0 },
    },
    rows,
    actorUserId: 'user-1',
    effectiveOptions: {},
    preparation: { vendor: null },
  };
}

function summarize(result: SerializedImportJob, rowUpdates: RowUpdate[]) {
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

describe('RowByRowApplyRunner sync and background parity', () => {
  async function runSync(p2034Attempts: Map<number, number>) {
    const rowUpdates: RowUpdate[] = [];
    const prisma = createSyncApplyPrisma(rowUpdates);
    const runner = createAppliedRunner(prisma);
    const result = await runner.run(
      parityInput(buildParityRows(), {}),
      ImportEntityType.VEHICLE_PARTY,
      buildParityWriteRow(p2034Attempts, 2),
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
    const rows = assignVehiclePartyApplySeqs(buildParityRows());
    const rowUpdates: RowUpdate[] = [];
    const prisma = createBackgroundApplyPrisma(rowUpdates, worker, rows);
    const runner = createAppliedRunner(prisma);
    const result = await runner.run(
      parityInput(rows, { worker }),
      ImportEntityType.VEHICLE_PARTY,
      buildParityWriteRow(p2034Attempts, 2),
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
    const sync = await runSync(new Map<number, number>());
    const background = await runBackground(new Map<number, number>());

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
