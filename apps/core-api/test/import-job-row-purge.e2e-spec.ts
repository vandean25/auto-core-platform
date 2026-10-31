import { INestApplication } from '@nestjs/common';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ImportJobStore } from '../src/import/import-job.store.js';
import {
  purgeStaleImportJobRowsForTenant,
  importJobRowPurgeCutoffs,
} from '../src/import/import-retention.helpers.js';
import {
  IMPORT_ERROR_CODES,
  IMPORT_FAILED_JOB_ROW_RETENTION_DAYS,
  IMPORT_JOB_RETENTION_DAYS,
  IMPORT_UPLOAD_RETENTION_DAYS,
} from '../src/import/import.constants.js';
import { createE2eApp, createE2eTenant } from './helpers/e2e-suite.js';
import { cleanupTestTenantGraph } from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

type TestRow = {
  row_no: number;
  action: ImportRowAction;
  external_id?: string;
  errors_json?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  normalized_json?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
};

type CreateJobParams = {
  status: ImportJobStatus;
  createdAt?: Date;
  updatedAt?: Date;
  appliedAt?: Date | null;
  failed_at?: Date | null;
  cancelled_at?: Date | null;
  options_json?: Prisma.InputJsonObject;
  totals_json?: Prisma.InputJsonObject;
  rows?: TestRow[];
};

describe('Import job row retention purge (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let tenantPrisma: PrismaService;
  let authToken: string;

  const now = new Date('2026-06-01T12:00:00.000Z');
  const cutoffs = importJobRowPurgeCutoffs(now);

  beforeAll(async () => {
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    basePrisma = app.get(PrismaService);
    const tenantContext = await createE2eTenant(app, basePrisma, 'row-purge');
    tenantId = tenantContext.tenantId;
    tenantPrisma = tenantContext.prisma;
    authToken = `Bearer ${tenantContext.authToken}`;
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    if (app) {
      await teardownTestApp(app, basePrisma);
    }
  });

  function daysAgo(days: number): Date {
    return new Date(now.getTime() - (days + 1) * 24 * 60 * 60 * 1000);
  }

  async function expectSingleErrorRow(
    jobId: string,
    expectedRowNo?: number,
  ): Promise<void> {
    const remaining = await tenantPrisma.importJobRow.findMany({
      where: { tenant_id: tenantId, import_job_id: jobId },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action).toBe(ImportRowAction.ERROR);
    if (expectedRowNo !== undefined) {
      expect(remaining[0].row_no).toBe(expectedRowNo);
    }
  }

  async function expectJobPurgedFlag(
    jobId: string,
    expectedStatus: ImportJobStatus,
  ): Promise<void> {
    const job = await tenantPrisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
    expect(job?.status).toBe(expectedStatus);
    const options = job?.options_json as Record<string, unknown>;
    expect(options.rows_purged).toBe(true);
  }

  async function expectJobStatus(
    jobId: string,
    expectedStatus: ImportJobStatus,
  ): Promise<void> {
    const job = await tenantPrisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
    expect(job?.status).toBe(expectedStatus);
  }

  async function expectRowCount(jobId: string, count: number): Promise<void> {
    const rows = await tenantPrisma.importJobRow.count({
      where: { tenant_id: tenantId, import_job_id: jobId },
    });
    expect(rows).toBe(count);
  }

  async function expectApplyConflict(
    jobId: string,
    expectedCode: string,
  ): Promise<void> {
    const response = await request(app.getHttpServer())
      .post(`/api/imports/${jobId}/apply`)
      .set('Authorization', authToken)
      .expect(409);

    expect(response.body.code).toBe(expectedCode);
  }

  async function createJob(params: CreateJobParams): Promise<string> {
    const errorCount =
      params.rows?.filter((r) => r.action === ImportRowAction.ERROR).length ??
      0;
    const createCount =
      params.rows?.filter((r) => r.action === ImportRowAction.CREATE).length ??
      0;
    const totalRows = params.rows?.length ?? 0;

    const job = await tenantPrisma.importJob.create({
      data: {
        tenant_id: tenantId,
        entity_type: ImportEntityType.CUSTOMER,
        source_system: 'e2e-purge',
        file_name: 'customers.csv',
        file_sha256: 'sha-e2e-purge',
        status: params.status,
        mapping_json: {
          external_id: 'External-ID',
          first_name: 'Vorname',
          last_name: 'Nachname',
        },
        options_json: params.options_json ?? {},
        totals_json: params.totals_json ?? {
          rows: totalRows,
          create: createCount,
          update: 0,
          skip: 0,
          error: errorCount,
        },
        createdAt: params.createdAt ?? now,
        updatedAt: params.updatedAt ?? params.createdAt ?? now,
        appliedAt: params.appliedAt,
        failed_at: params.failed_at,
        cancelled_at: params.cancelled_at,
      },
      select: { id: true },
    });

    if (params.rows && params.rows.length > 0) {
      await tenantPrisma.importJobRow.createMany({
        data: params.rows.map((row) => ({
          tenant_id: tenantId,
          import_job_id: job.id,
          row_no: row.row_no,
          action: row.action,
          external_id: row.external_id ?? `ext-${row.row_no}`,
          errors_json:
            row.errors_json ??
            (row.action === ImportRowAction.ERROR
              ? [
                  {
                    field: 'external_id',
                    message: 'Missing ID',
                    code: 'MISSING_FIELD',
                  },
                ]
              : Prisma.JsonNull),
          normalized_json:
            row.normalized_json ??
            (row.action === ImportRowAction.CREATE
              ? {
                  external_id: `ext-${row.row_no}`,
                  first_name: 'Max',
                  last_name: 'Mustermann',
                }
              : Prisma.JsonNull),
        })),
      });
    }

    return job.id;
  }

  async function createFailedDryRunJobWithRows(
    optionsJson: Prisma.InputJsonObject = { worker: { phase: 'dry_run' } },
    customErrorsJson?: Prisma.InputJsonValue,
  ): Promise<string> {
    const staleFailedAt = daysAgo(IMPORT_FAILED_JOB_ROW_RETENTION_DAYS);
    return createJob({
      status: ImportJobStatus.FAILED,
      failed_at: staleFailedAt,
      createdAt: staleFailedAt,
      options_json: optionsJson,
      rows: [
        { row_no: 1, action: ImportRowAction.CREATE },
        {
          row_no: 2,
          action: ImportRowAction.ERROR,
          ...(customErrorsJson ? { errors_json: customErrorsJson } : {}),
        },
      ],
    });
  }

  async function createDryRunJobWithRows(
    rows: TestRow[],
    optionsJson: Prisma.InputJsonObject = {},
  ): Promise<string> {
    const staleDryRunAt = daysAgo(IMPORT_UPLOAD_RETENTION_DAYS);
    return createJob({
      status: ImportJobStatus.DRY_RUN_DONE,
      createdAt: staleDryRunAt,
      updatedAt: staleDryRunAt,
      options_json: optionsJson,
      rows,
    });
  }

  describe('Row purge for each terminal and stale status', () => {
    it('purges all rows for APPLIED jobs older than 180 days', async () => {
      const staleAppliedAt = daysAgo(IMPORT_JOB_RETENTION_DAYS);
      const jobId = await createJob({
        status: ImportJobStatus.APPLIED,
        appliedAt: staleAppliedAt,
        createdAt: staleAppliedAt,
        rows: [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.CREATE },
        ],
      });

      const counts = await purgeStaleImportJobRowsForTenant(
        tenantPrisma,
        tenantId,
        now,
      );

      expect(counts.jobs_scanned).toBeGreaterThanOrEqual(1);
      await expectRowCount(jobId, 0);
      await expectJobStatus(jobId, ImportJobStatus.APPLIED);
    });

    it('expires stale DRY_RUN_DONE jobs (>7d): moves to CANCELLED (cancel_reason: expired), deletes non-error rows, keeps ERROR rows and writes audit log', async () => {
      const jobId = await createDryRunJobWithRows(
        [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.ERROR },
          { row_no: 3, action: ImportRowAction.CREATE },
        ],
        { test_option: true },
      );

      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);

      await expectJobStatus(jobId, ImportJobStatus.CANCELLED);
      const job = await tenantPrisma.importJob.findFirst({
        where: { tenant_id: tenantId, id: jobId },
      });
      const options = job?.options_json as Record<string, unknown>;
      expect(options.cancel_reason).toBe('expired');
      expect(options.test_option).toBe(true);
      expect(job?.cancelled_at).toEqual(now);

      await expectSingleErrorRow(jobId, 2);

      const auditLog = await tenantPrisma.auditLog.findFirst({
        where: {
          tenant_id: tenantId,
          entity_type: 'ImportJob',
          entity_id: jobId,
        },
      });
      expect(auditLog).toBeDefined();
      const after = auditLog?.after as Record<string, unknown>;
      expect(after.event).toBe('import_job.expired');
      expect(after.cancel_reason).toBe('expired');
    });

    it('purges staged rows for FAILED jobs (>1d, dry run): marks rows_purged, deletes non-error rows, keeps ERROR rows', async () => {
      const jobId = await createFailedDryRunJobWithRows();
      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);
      await expectJobPurgedFlag(jobId, ImportJobStatus.FAILED);
      await expectSingleErrorRow(jobId, 2);
    });

    it('does not purge FAILED jobs from apply phase at 1-day mark', async () => {
      const jobId = await createFailedDryRunJobWithRows({
        worker: { phase: 'apply' },
      });
      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);
      await expectRowCount(jobId, 2);
    });

    it('purges staged rows for CANCELLED jobs (>1d): marks rows_purged, deletes non-error rows, keeps ERROR rows', async () => {
      const staleCancelledAt = daysAgo(IMPORT_FAILED_JOB_ROW_RETENTION_DAYS);
      const jobId = await createJob({
        status: ImportJobStatus.CANCELLED,
        cancelled_at: staleCancelledAt,
        createdAt: staleCancelledAt,
        rows: [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.ERROR },
        ],
      });

      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);
      await expectJobPurgedFlag(jobId, ImportJobStatus.CANCELLED);
      await expectSingleErrorRow(jobId);
    });

    it('purges remaining ERROR rows for jobs older than 180 days', async () => {
      const ancientAt = daysAgo(IMPORT_JOB_RETENTION_DAYS);
      const jobId = await createJob({
        status: ImportJobStatus.FAILED,
        failed_at: ancientAt,
        createdAt: ancientAt,
        options_json: { rows_purged: true },
        rows: [{ row_no: 1, action: ImportRowAction.ERROR }],
      });

      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);
      await expectRowCount(jobId, 0);
    });
  });

  describe('Grace period boundaries (±1 ms)', () => {
    it('purges rows for jobs just beyond the grace cutoff (-1 ms) and keeps rows just within (+1 ms)', async () => {
      const boundaryPast = new Date(cutoffs.dryRunCutoff.getTime() - 1);
      const boundaryFuture = new Date(cutoffs.dryRunCutoff.getTime() + 1);

      const pastJobId = await createJob({
        status: ImportJobStatus.DRY_RUN_DONE,
        createdAt: boundaryPast,
        updatedAt: boundaryPast,
        rows: [{ row_no: 1, action: ImportRowAction.CREATE }],
      });

      const futureJobId = await createJob({
        status: ImportJobStatus.DRY_RUN_DONE,
        createdAt: boundaryFuture,
        updatedAt: boundaryFuture,
        rows: [{ row_no: 1, action: ImportRowAction.CREATE }],
      });

      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);

      await expectJobStatus(pastJobId, ImportJobStatus.CANCELLED);
      await expectRowCount(pastJobId, 0);

      await expectJobStatus(futureJobId, ImportJobStatus.DRY_RUN_DONE);
      await expectRowCount(futureJobId, 1);
    });

    it('purges rows for FAILED jobs just beyond the 1-day cutoff (-1 ms) and keeps rows just within (+1 ms)', async () => {
      const boundaryPast = new Date(cutoffs.failedCutoff.getTime() - 1);
      const boundaryFuture = new Date(cutoffs.failedCutoff.getTime() + 1);

      const pastJobId = await createJob({
        status: ImportJobStatus.FAILED,
        failed_at: boundaryPast,
        createdAt: boundaryPast,
        options_json: { worker: { phase: 'dry_run' } },
        rows: [{ row_no: 1, action: ImportRowAction.CREATE }],
      });

      const futureJobId = await createJob({
        status: ImportJobStatus.FAILED,
        failed_at: boundaryFuture,
        createdAt: boundaryFuture,
        options_json: { worker: { phase: 'dry_run' } },
        rows: [{ row_no: 1, action: ImportRowAction.CREATE }],
      });

      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);

      await expectJobPurgedFlag(pastJobId, ImportJobStatus.FAILED);
      await expectRowCount(pastJobId, 0);

      const futureJob = await tenantPrisma.importJob.findFirst({
        where: { tenant_id: tenantId, id: futureJobId },
      });
      expect(futureJob?.status).toBe(ImportJobStatus.FAILED);
      const futureOpts = (futureJob?.options_json ?? {}) as Record<
        string,
        unknown
      >;
      expect(futureOpts.rows_purged).toBeUndefined();
      await expectRowCount(futureJobId, 1);
    });
  });

  describe('Apply guard after purge and expiry', () => {
    it('returns 409 IMPORT_JOB_EXPIRED when attempting to apply an expired dry-run job', async () => {
      const jobId = await createJob({
        status: ImportJobStatus.CANCELLED,
        options_json: { cancel_reason: 'expired' },
        rows: [],
      });
      await expectApplyConflict(jobId, IMPORT_ERROR_CODES.JOB_EXPIRED);
    });

    it('returns 409 IMPORT_JOB_PURGED when attempting to apply a job with rows_purged: true', async () => {
      const jobId = await createJob({
        status: ImportJobStatus.FAILED,
        options_json: { rows_purged: true },
        rows: [],
      });
      await expectApplyConflict(jobId, IMPORT_ERROR_CODES.JOB_PURGED);
    });
  });

  describe('Error CSV download after row purge', () => {
    it('allows downloading error CSV after non-error rows have been purged', async () => {
      const jobId = await createFailedDryRunJobWithRows(
        { worker: { phase: 'dry_run' } },
        [
          {
            field: 'external_id',
            message: 'Pflichtfeld fehlt',
            code: 'REQUIRED_FIELD',
          },
        ],
      );

      // Purge non-error rows
      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);

      // Verify errors.csv still returns the ERROR rows
      const response = await request(app.getHttpServer())
        .get(`/api/imports/${jobId}/errors.csv`)
        .set('Authorization', authToken)
        .set('Accept-Language', 'de-AT')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/csv/);
      expect(response.text).toContain('REQUIRED_FIELD');
      expect(response.text).toContain('ext-2');
      expect(response.text).toContain(
        'Die Originaldatei ist nicht mehr verfügbar.',
      );
    });
  });

  describe('Concurrent apply race safety', () => {
    it('aborts row purge and keeps rows intact if job status transitions to APPLYING concurrently', async () => {
      const jobId = await createDryRunJobWithRows([
        { row_no: 1, action: ImportRowAction.CREATE },
        { row_no: 2, action: ImportRowAction.CREATE },
      ]);

      // Concurrently change status to APPLYING before purge lock
      await tenantPrisma.importJob.updateMany({
        where: { tenant_id: tenantId, id: jobId },
        data: { status: ImportJobStatus.APPLYING },
      });

      // Run purge
      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);

      // Verify the job was NOT modified or cancelled, and its rows were NOT deleted
      await expectJobStatus(jobId, ImportJobStatus.APPLYING);
      await expectRowCount(jobId, 2);
    });

    it('rejects apply on purged FAILED job with 409 IMPORT_JOB_PURGED and does not overwrite options', async () => {
      const jobId = await createJob({
        status: ImportJobStatus.FAILED,
        failed_at: daysAgo(2),
        options_json: { worker: { phase: 'dry_run' } },
        rows: [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.ERROR },
        ],
      });

      // Purge job non-error rows
      await purgeStaleImportJobRowsForTenant(tenantPrisma, tenantId, now);
      await expectJobPurgedFlag(jobId, ImportJobStatus.FAILED);
      await expectRowCount(jobId, 1);

      // Attempt concurrent apply via HTTP endpoint
      await expectApplyConflict(jobId, IMPORT_ERROR_CODES.JOB_PURGED);

      // Verify job status remains FAILED and options retain rows_purged: true
      const job = await tenantPrisma.importJob.findFirst({
        where: { tenant_id: tenantId, id: jobId },
      });
      expect(job?.status).toBe(ImportJobStatus.FAILED);
      const opts = (job?.options_json ?? {}) as Record<string, unknown>;
      expect(opts.rows_purged).toBe(true);
    });

    it('proves atomic rejection and preserves purged flag when purge marks job between Apply read and Apply update', async () => {
      const jobId = await createJob({
        status: ImportJobStatus.FAILED,
        failed_at: daysAgo(2),
        options_json: { worker: { phase: 'dry_run' } },
        rows: [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.ERROR },
        ],
      });

      let intercepted = false;
      const interceptingPrisma = new Proxy(tenantPrisma, {
        get(target, prop, receiver) {
          if (prop === '$transaction') {
            return async (
              fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
            ) => {
              return tenantPrisma.$transaction(async (tx) => {
                const originalFindFirst = tx.importJob.findFirst.bind(
                  tx.importJob,
                );
                const interceptedTx = new Proxy(tx, {
                  get(txTarget, txProp) {
                    if (txProp === 'importJob') {
                      return new Proxy(txTarget.importJob, {
                        get(jobTarget, jobProp) {
                          if (jobProp === 'findFirst') {
                            return async (
                              ...args: Parameters<typeof originalFindFirst>
                            ) => {
                              const result = await originalFindFirst(...args);
                              const callArgs = args[0] as
                                | { where?: { id?: string } }
                                | undefined;
                              if (
                                !intercepted &&
                                callArgs?.where?.id === jobId
                              ) {
                                intercepted = true;
                                // Purge marks the job row in the DB before Apply performs updateMany
                                await purgeStaleImportJobRowsForTenant(
                                  tenantPrisma,
                                  tenantId,
                                  now,
                                );
                              }
                              return result;
                            };
                          }
                          return Reflect.get(jobTarget, jobProp);
                        },
                      });
                    }
                    return Reflect.get(txTarget, txProp);
                  },
                });
                return fn(interceptedTx);
              });
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      const store = new ImportJobStore(interceptingPrisma);

      const lock = await store.lockForApply(tenantId, jobId);
      // Apply was atomically rejected because updatedAt changed!
      expect(lock.count).toBe(0);

      // Verify the job in DB remains FAILED with rows_purged: true intact
      const job = await tenantPrisma.importJob.findFirst({
        where: { tenant_id: tenantId, id: jobId },
      });
      expect(job?.status).toBe(ImportJobStatus.FAILED);
      const opts = (job?.options_json ?? {}) as Record<string, unknown>;
      expect(opts.rows_purged).toBe(true);
    });
  });

  describe('Starvation and budget continuation', () => {
    it('pages past skipped apply-phase FAILED jobs to find eligible jobs without starvation', async () => {
      // 26 apply-phase FAILED jobs (ineligible for 1d row purge)
      for (let i = 0; i < 26; i++) {
        await createJob({
          status: ImportJobStatus.FAILED,
          failed_at: daysAgo(2),
          createdAt: new Date(now.getTime() - (100 + i) * 60 * 1000),
          options_json: { worker: { phase: 'apply' } },
          rows: [{ row_no: 1, action: ImportRowAction.CREATE }],
        });
      }

      // 1 newer dry-run FAILED job that IS eligible
      const eligibleJobId = await createJob({
        status: ImportJobStatus.FAILED,
        failed_at: daysAgo(2),
        createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        options_json: { worker: { phase: 'dry_run' } },
        rows: [{ row_no: 1, action: ImportRowAction.CREATE }],
      });

      const result = await purgeStaleImportJobRowsForTenant(
        tenantPrisma,
        tenantId,
        now,
        {
          jobsPerTenant: 25,
        },
      );

      expect(result.rows_deleted).toBeGreaterThanOrEqual(1);
      await expectJobPurgedFlag(eligibleJobId, ImportJobStatus.FAILED);
      await expectRowCount(eligibleJobId, 0);
    });

    it('continues half-purged jobs on subsequent runs when budget truncated', async () => {
      const jobId = await createJob({
        status: ImportJobStatus.FAILED,
        failed_at: daysAgo(2),
        createdAt: daysAgo(3),
        options_json: { worker: { phase: 'dry_run' } },
        rows: [
          { row_no: 1, action: ImportRowAction.CREATE },
          { row_no: 2, action: ImportRowAction.CREATE },
          { row_no: 3, action: ImportRowAction.CREATE },
          { row_no: 4, action: ImportRowAction.CREATE },
          { row_no: 5, action: ImportRowAction.CREATE },
        ],
      });

      // Run 1 with rowBudget = 2
      const run1 = await purgeStaleImportJobRowsForTenant(
        tenantPrisma,
        tenantId,
        now,
        {
          rowBudget: 2,
        },
      );

      expect(run1.rows_deleted).toBe(2);
      await expectRowCount(jobId, 3);
      const job1 = await tenantPrisma.importJob.findFirst({
        where: { tenant_id: tenantId, id: jobId },
      });
      const opts1 = (job1?.options_json ?? {}) as Record<string, unknown>;
      expect(opts1.rows_purged).toBe(true);
      expect(opts1.rows_purge_completed).toBe(false);

      // Run 2 completes the purge
      const run2 = await purgeStaleImportJobRowsForTenant(
        tenantPrisma,
        tenantId,
        now,
        {
          rowBudget: 10,
        },
      );

      expect(run2.rows_deleted).toBe(3);
      await expectRowCount(jobId, 0);
      const job2 = await tenantPrisma.importJob.findFirst({
        where: { tenant_id: tenantId, id: jobId },
      });
      const opts2 = (job2?.options_json ?? {}) as Record<string, unknown>;
      expect(opts2.rows_purged).toBe(true);
      expect(opts2.rows_purge_completed).toBe(true);
    });
  });
});
