import { jest } from '@jest/globals';
import { ImportRowAction } from '@prisma/client';
import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from './import-worker-handoff.constants.js';
import { importDryRunReconcileProgress } from './import-job.worker-state.js';
import type { ImportJobStore } from './import-job.store.js';
import type { ImportJobTotals } from './import.types.js';

type PersistDryRunReconcileChunk = ImportJobStore['persistDryRunReconcileChunk'];
type PersistDryRunReconcileResult = Exclude<
  Awaited<ReturnType<PersistDryRunReconcileChunk>>,
  null
>;

async function noopCompleteDryRun(_totals: ImportJobTotals): Promise<void> {
  return undefined;
}

function mockPersistResult(
  partial: Partial<PersistDryRunReconcileResult> = {},
): PersistDryRunReconcileResult {
  return {
    job: {
      worker_claim_seq: 1,
      worker_recovery_seq: 0,
      ...partial.job,
    } as PersistDryRunReconcileResult['job'],
    totals: partial.totals ?? {
      rows: 4,
      create: 4,
      update: 0,
      skip: 0,
      error: 0,
    },
  };
}

const replanImportDryRunUnit = jest.fn(
  async ({ unit }: { unit: { replan_row_nos: number[] } }) =>
    unit.replan_row_nos.map((rowNo: number) => ({
      row_no: rowNo,
      action: ImportRowAction.CREATE,
      errors: [],
      warnings: [],
      normalized_json: {},
      external_id: null,
    })),
);

const enqueueImportWorkerContinuation = jest.fn();
const extendWorkerLease = jest.fn(async () => true);

function mockReconcileJobStore(
  persist: PersistDryRunReconcileChunk,
): ImportJobStore {
  return {
    persistDryRunReconcileChunk: persist,
    extendWorkerLease,
  } as never;
}

jest.unstable_mockModule('./import-dry-run-reconcile.plan-unit.js', () => ({
  replanImportDryRunUnit,
}));

jest.unstable_mockModule('./import-worker.flow.js', () => ({
  enqueueImportWorkerContinuation,
  importWorkerTaskClaimSeqForHandoff: (seq: number) => seq + 1,
  requeueImportWorkerAfterLeaseSkip: jest.fn(),
}));

const { runBackgroundDryRunReconcileChunk } = await import(
  './import-background-dry-run.reconcile.js'
);

function baseUnits() {
  return [
    {
      context_from_row: 1,
      context_to_row: 2,
      replan_row_nos: [1, 2],
    },
    {
      context_from_row: 10,
      context_to_row: 11,
      replan_row_nos: [10, 11],
    },
  ];
}

function baseOptions(units = baseUnits(), cursor = 0) {
  return {
    worker: {
      phase: 'dry_run' as const,
      lease_token: 'lease',
      lease_until: new Date().toISOString(),
      processed_rows: 0,
      started_at: new Date().toISOString(),
      dry_run_reconcile_active: true,
      dry_run_reconcile_cursor: cursor,
      dry_run_reconcile_units: units,
    },
    upload: { object_key: 'imports/test.csv' },
  };
}

describe('runBackgroundDryRunReconcileChunk', () => {
  beforeEach(() => {
    replanImportDryRunUnit.mockClear();
    enqueueImportWorkerContinuation.mockClear();
    extendWorkerLease.mockClear();
  });

  it('stops before the next unit when the chunk budget is exhausted', async () => {
    const persist = jest
      .fn<PersistDryRunReconcileChunk>()
      .mockResolvedValue(mockPersistResult());
    let clockReads = 0;
    const nowMs = () => {
      clockReads += 1;
      if (clockReads === 1) {
        return 10_000;
      }
      if (clockReads === 2) {
        return 10_000;
      }
      return 10_000 + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
    };

    await runBackgroundDryRunReconcileChunk({
      jobStore: mockReconcileJobStore(persist),
      prisma: {} as never,
      fileStorage: {} as never,
      tenantId: 't',
      jobId: 'j',
      handler: {} as never,
      options: baseOptions(),
      job: {
        source_system: 'legacy',
        file_sha256: 'sha',
        mapping_json: {},
        totals_json: { rows: 4, create: 0, update: 0, skip: 0, error: 0 },
      },
      flow: {} as never,
      completeDryRun: noopCompleteDryRun,
      nowMs,
    });

    expect(replanImportDryRunUnit).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(
      't',
      'j',
      expect.arrayContaining([expect.objectContaining({ row_no: 1 })]),
      { dry_run_reconcile_cursor: 1 },
      expect.anything(),
      'lease',
      undefined,
    );
    const persistedRows = persist.mock.calls[0][2] as { row_no: number }[];
    expect(persistedRows.map((row) => row.row_no).sort()).toEqual([1, 2]);
  });

  it('does not persist when the budget blocks every unit in the chunk', async () => {
    const persist = jest.fn<PersistDryRunReconcileChunk>();
    let clockReads = 0;
    const nowMs = () => {
      clockReads += 1;
      if (clockReads === 1) {
        return 50_000;
      }
      return 50_000 + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
    };

    await runBackgroundDryRunReconcileChunk({
      jobStore: mockReconcileJobStore(persist),
      prisma: {} as never,
      fileStorage: {} as never,
      tenantId: 't',
      jobId: 'j',
      handler: {} as never,
      options: baseOptions(),
      job: {
        source_system: 'legacy',
        file_sha256: 'sha',
        mapping_json: {},
        totals_json: { rows: 4, create: 0, update: 0, skip: 0, error: 0 },
      },
      flow: {} as never,
      completeDryRun: noopCompleteDryRun,
      nowMs,
    });

    expect(replanImportDryRunUnit).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('resumes at the next unit without replanning the committed unit', async () => {
    const persist = jest
      .fn<PersistDryRunReconcileChunk>()
      .mockResolvedValueOnce(
        mockPersistResult({
          job: {
            worker_claim_seq: 2,
            worker_recovery_seq: 0,
          } as PersistDryRunReconcileResult['job'],
          totals: { rows: 4, create: 2, update: 0, skip: 0, error: 0 },
        }),
      )
      .mockResolvedValueOnce(
        mockPersistResult({
          job: {
            worker_claim_seq: 3,
            worker_recovery_seq: 0,
          } as PersistDryRunReconcileResult['job'],
          totals: { rows: 4, create: 4, update: 0, skip: 0, error: 0 },
        }),
      );
    const completeDryRun = jest.fn(noopCompleteDryRun);
    let clockReads = 0;
    const nowMs = () => {
      clockReads += 1;
      if (clockReads <= 2) {
        return 1_000;
      }
      return 1_000 + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
    };

    const common = {
      jobStore: mockReconcileJobStore(persist),
      prisma: {} as never,
      fileStorage: {} as never,
      tenantId: 't',
      jobId: 'j',
      handler: {} as never,
      job: {
        source_system: 'legacy',
        file_sha256: 'sha',
        mapping_json: {},
        totals_json: { rows: 4, create: 0, update: 0, skip: 0, error: 0 },
      },
      flow: {} as never,
      completeDryRun,
      nowMs,
    };

    await runBackgroundDryRunReconcileChunk({
      ...common,
      options: baseOptions(),
    });
    expect(replanImportDryRunUnit).toHaveBeenCalledTimes(1);
    expect(replanImportDryRunUnit.mock.calls[0][0].unit.replan_row_nos).toEqual([
      1,
      2,
    ]);

    replanImportDryRunUnit.mockClear();
    await runBackgroundDryRunReconcileChunk({
      ...common,
      options: baseOptions(baseUnits(), 1),
    });
    expect(replanImportDryRunUnit).toHaveBeenCalledTimes(1);
    expect(replanImportDryRunUnit.mock.calls[0][0].unit.replan_row_nos).toEqual([
      10,
      11,
    ]);
    expect(completeDryRun).toHaveBeenCalled();
    expect(enqueueImportWorkerContinuation).toHaveBeenCalledTimes(1);
  });

  it('finishes many units across multiple chunk invocations', async () => {
    const units = Array.from({ length: 5 }, (_, index) => ({
      context_from_row: index * 2 + 1,
      context_to_row: index * 2 + 2,
      replan_row_nos: [index * 2 + 1, index * 2 + 2],
    }));
    const persist = jest
      .fn<PersistDryRunReconcileChunk>()
      .mockImplementation(async (_tenantId, _jobId, _rows, workerPatch, _options, _lease, finalize) =>
        mockPersistResult({
          job: {
            worker_claim_seq: workerPatch.dry_run_reconcile_cursor ?? 0,
            worker_recovery_seq: 0,
          } as PersistDryRunReconcileResult['job'],
          totals: finalize
            ? { rows: 10, create: 10, update: 0, skip: 0, error: 0 }
            : { rows: 10, create: 2, update: 0, skip: 0, error: 0 },
        }),
      );
    const completeDryRun = jest.fn(noopCompleteDryRun);
    let cursor = 0;
    let chunks = 0;
    while (cursor < units.length) {
      chunks += 1;
      let clockReads = 0;
      const nowMs = () => {
        clockReads += 1;
        if (clockReads <= 2) {
          return 1_000;
        }
        return 1_000 + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
      };
      await runBackgroundDryRunReconcileChunk({
        jobStore: mockReconcileJobStore(persist),
        prisma: {} as never,
        fileStorage: {} as never,
        tenantId: 't',
        jobId: 'j',
        handler: {} as never,
        options: {
          worker: {
            phase: 'dry_run',
            lease_token: 'lease',
            lease_until: new Date().toISOString(),
            processed_rows: 0,
            started_at: new Date().toISOString(),
            dry_run_reconcile_active: true,
            dry_run_reconcile_cursor: cursor,
            dry_run_reconcile_units: units,
          },
          upload: { object_key: 'imports/test.csv' },
        },
        job: {
          source_system: 'legacy',
          file_sha256: 'sha',
          mapping_json: {},
          totals_json: { rows: 10, create: 0, update: 0, skip: 0, error: 0 },
        },
        flow: {} as never,
        completeDryRun,
        nowMs,
      });
      cursor += 1;
    }
    expect(chunks).toBe(5);
    expect(replanImportDryRunUnit).toHaveBeenCalledTimes(5);
    expect(completeDryRun).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(5);
  });

  it('budget stop after one unit increases reconcile progress only for completed units', async () => {
    const units = [
      {
        context_from_row: 1,
        context_to_row: 2,
        replan_row_nos: [1, 2],
      },
      {
        context_from_row: 10,
        context_to_row: 11,
        replan_row_nos: [10, 11],
      },
    ];
    const worker = {
      phase: 'dry_run' as const,
      lease_token: 'lease',
      lease_until: new Date().toISOString(),
      processed_rows: 0,
      started_at: new Date().toISOString(),
      dry_run_reconcile_active: true,
      dry_run_reconcile_cursor: 0,
      dry_run_reconcile_units: units,
    };
    const progressBefore = importDryRunReconcileProgress(worker);
    const persist = jest
      .fn<PersistDryRunReconcileChunk>()
      .mockResolvedValue(
        mockPersistResult({
          totals: { rows: 4, create: 2, update: 0, skip: 0, error: 0 },
        }),
      );
    let clockReads = 0;
    const nowMs = () => {
      clockReads += 1;
      if (clockReads <= 2) {
        return 100;
      }
      return 100 + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
    };
    await runBackgroundDryRunReconcileChunk({
      jobStore: mockReconcileJobStore(persist),
      prisma: {} as never,
      fileStorage: {} as never,
      tenantId: 't',
      jobId: 'j',
      handler: {} as never,
      options: { worker, upload: { object_key: 'imports/test.csv' } },
      job: {
        source_system: 'legacy',
        file_sha256: 'sha',
        mapping_json: {},
        totals_json: { rows: 4, create: 0, update: 0, skip: 0, error: 0 },
      },
      flow: {} as never,
      completeDryRun: noopCompleteDryRun,
      nowMs,
    });
    expect(importDryRunReconcileProgress({ ...worker, dry_run_reconcile_cursor: 1 })).toBe(
      progressBefore + units[0].replan_row_nos.length,
    );
    expect(replanImportDryRunUnit).toHaveBeenCalledTimes(1);
  });
});
