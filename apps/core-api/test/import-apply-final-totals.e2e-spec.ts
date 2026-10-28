import { INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS } from '../src/import/import-worker-handoff.constants.js';
import { AppModule } from '../src/app.module.js';
import { ImportService } from '../src/import/import.service.js';
import { ImportJobStore } from '../src/import/import-job.store.js';
import type { ImportJobTotals } from '../src/import/import.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { DryRunRowResult } from '../src/import/import.types.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

async function totalsFromRowGroupBy(
  prisma: ReturnType<typeof createTenantAwarePrisma<PrismaService>>,
  tenantId: string,
  jobId: string,
): Promise<Pick<ImportJobTotals, 'create' | 'update' | 'skip' | 'error'>> {
  const groups = await prisma.importJobRow.groupBy({
    by: ['action'],
    where: { tenant_id: tenantId, import_job_id: jobId },
    _count: { _all: true },
  });
  const tallied = { create: 0, update: 0, skip: 0, error: 0 };
  for (const group of groups) {
    if (group.action === ImportRowAction.CREATE)
      tallied.create = group._count._all;
    if (group.action === ImportRowAction.UPDATE)
      tallied.update = group._count._all;
    if (group.action === ImportRowAction.SKIP) tallied.skip = group._count._all;
    if (group.action === ImportRowAction.ERROR)
      tallied.error = group._count._all;
  }
  return tallied;
}

function makeCustomerRow(
  rowNo: number,
  action: ImportRowAction = ImportRowAction.CREATE,
  idPrefix = 'ext',
): DryRunRowResult {
  return {
    row_no: rowNo,
    external_id: `${idPrefix}-${rowNo}`,
    action,
    entity_id: null,
    errors:
      action === ImportRowAction.ERROR
        ? [{ code: 'IMPORT_ROW_ERROR', message: 'planned error' }]
        : [],
    warnings: [],
    normalized: {
      external_id: `ext-${rowNo}`,
      ...(action === ImportRowAction.CREATE
        ? { first_name: 'Test', last_name: `User${rowNo}` }
        : {}),
    },
  };
}

describe('import apply final totals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tenant = await createTestTenant(prisma, 'import-final-totals');
  });

  afterAll(async () => {
    if (tenant) {
      await cleanupTestTenantGraph(prisma, tenant.tenantId);
    }
    if (app) {
      await teardownTestApp(app, prisma);
    }
  });

  it('stores sync APPLIED totals from persisted rows', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const store = new ImportJobStore(prisma);
    const importService = app.get(ImportService);
    const actor = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    const rows = [makeCustomerRow(1), makeCustomerRow(2), makeCustomerRow(3)];
    const job = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.createDryRunJob({
          tenantId: tenant.tenantId,
          entityType: ImportEntityType.CUSTOMER,
          sourceSystem: 'legacy',
          fileSha256: 'sha-sync-totals',
          mapping: { external_id: 'external_id' },
          options: {},
          totals: { rows: 3, create: 3, update: 0, skip: 0, error: 0 },
          actorUserId: actor.id,
          rows,
        }),
      { userId: tenant.firebaseUid, email: tenant.email, role: 'ADMIN' },
    );
    await runWithTenantContext(
      tenant.tenantId,
      async () => importService.applyJob(job.id),
      { userId: tenant.firebaseUid, email: tenant.email, role: 'ADMIN' },
    );
    const applied = await tenantPrisma.importJob.findFirst({
      where: { id: job.id },
    });
    expect(applied?.status).toBe(ImportJobStatus.APPLIED);
    const totals = applied?.totals_json as ImportJobTotals;
    const grouped = await totalsFromRowGroupBy(
      tenantPrisma,
      tenant.tenantId,
      job.id,
    );
    expect(totals.create).toBe(grouped.create);
    expect(totals.update).toBe(grouped.update);
    expect(totals.skip).toBe(grouped.skip);
    expect(totals.error).toBe(grouped.error);
    expect(totals.rows).toBe(3);
  });

  it('stores APPLIED totals for skip and error rows from groupBy', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const store = new ImportJobStore(prisma);
    const importService = app.get(ImportService);
    const actor = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    const rows = [
      makeCustomerRow(1, ImportRowAction.SKIP),
      makeCustomerRow(2, ImportRowAction.ERROR),
    ];
    const job = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.createDryRunJob({
          tenantId: tenant.tenantId,
          entityType: ImportEntityType.CUSTOMER,
          sourceSystem: 'legacy',
          fileSha256: 'sha-skip-error-totals',
          mapping: { external_id: 'external_id' },
          options: {},
          totals: { rows: 2, create: 0, update: 0, skip: 1, error: 1 },
          actorUserId: actor.id,
          rows,
        }),
      { userId: tenant.firebaseUid, email: tenant.email, role: 'ADMIN' },
    );
    await runWithTenantContext(
      tenant.tenantId,
      async () => importService.applyJob(job.id),
      { userId: tenant.firebaseUid, email: tenant.email, role: 'ADMIN' },
    );
    const applied = await tenantPrisma.importJob.findFirst({
      where: { id: job.id },
    });
    expect(applied?.status).toBe(ImportJobStatus.APPLIED);
    const totals = applied?.totals_json as ImportJobTotals;
    const grouped = await totalsFromRowGroupBy(
      tenantPrisma,
      tenant.tenantId,
      job.id,
    );
    expect(totals).toMatchObject({
      rows: 2,
      create: grouped.create,
      update: grouped.update,
      skip: grouped.skip,
      error: grouped.error,
    });
    expect(totals.skip).toBe(1);
    expect(totals.error).toBe(1);
  });

  it('re-applies after retry_exhausted with totals from persisted rows', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const store = new ImportJobStore(prisma);
    const importService = app.get(ImportService);
    const actor = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    const rows = [
      makeCustomerRow(1, ImportRowAction.CREATE, 'reapply'),
      makeCustomerRow(2, ImportRowAction.CREATE, 'reapply'),
    ];
    const job = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.createDryRunJob({
          tenantId: tenant.tenantId,
          entityType: ImportEntityType.CUSTOMER,
          sourceSystem: 'legacy',
          fileSha256: 'sha-reapply-exhausted',
          mapping: { external_id: 'external_id' },
          options: {},
          totals: { rows: 2, create: 2, update: 0, skip: 0, error: 0 },
          actorUserId: actor.id,
          rows,
        }),
      { userId: tenant.firebaseUid, email: tenant.email, role: 'ADMIN' },
    );
    const db = prisma.client;
    const original = db.$transaction.bind(db);
    let calls = 0;
    db.$transaction = ((...args: unknown[]) => {
      calls += 1;
      if (calls > 2) {
        throw new Prisma.PrismaClientKnownRequestError('write conflict', {
          code: 'P2034',
          clientVersion: 'test',
        });
      }
      return original(...(args as Parameters<typeof original>));
    }) as typeof db.$transaction;
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const identity = {
      userId: tenant.firebaseUid,
      email: tenant.email,
      role: 'ADMIN',
    };
    await expect(
      runWithTenantContext(
        tenant.tenantId,
        async () => importService.applyJob(job.id),
        identity,
      ),
    ).rejects.toThrow();
    db.$transaction = original;
    expect(errorLog.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `import.job.failed jobId=${job.id} phase=apply`,
        ),
        expect.stringContaining('reason=retry_exhausted'),
        expect.stringContaining('cause='),
      ]),
    );
    const failed = await tenantPrisma.importJob.findFirst({
      where: { id: job.id },
    });
    expect(failed?.status).toBe(ImportJobStatus.FAILED);
    expect(
      (failed?.options_json as { apply_failure_reason?: string })
        .apply_failure_reason,
    ).toBe('retry_exhausted');
    errorLog.mockRestore();

    await runWithTenantContext(
      tenant.tenantId,
      async () => importService.applyJob(job.id),
      identity,
    );
    const applied = await tenantPrisma.importJob.findFirst({
      where: { id: job.id },
    });
    expect(applied?.status).toBe(ImportJobStatus.APPLIED);
    const totals = applied?.totals_json as ImportJobTotals;
    const grouped = await totalsFromRowGroupBy(
      tenantPrisma,
      tenant.tenantId,
      job.id,
    );
    expect(totals.create).toBe(grouped.create);
    expect(totals.update).toBe(grouped.update);
    expect(totals.skip).toBe(grouped.skip);
    expect(totals.error).toBe(grouped.error);
    expect(totals.create + totals.error + totals.skip + totals.update).toBe(2);
  }, 120_000);

  it('resumes a background apply across batches and stores grouped totals', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const store = new ImportJobStore(prisma);
    const importService = app.get(ImportService);
    const actor = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    const rowCount = 51;
    const rows = Array.from({ length: rowCount }, (_, index) =>
      makeCustomerRow(index + 1, ImportRowAction.CREATE, 'bgresume'),
    );
    const identity = {
      userId: tenant.firebaseUid,
      email: tenant.email,
      role: 'ADMIN',
    };
    {
      const job = await runWithTenantContext(
        tenant.tenantId,
        async () =>
          store.createDryRunJob({
            tenantId: tenant.tenantId,
            entityType: ImportEntityType.CUSTOMER,
            sourceSystem: 'legacy',
            fileSha256: 'sha-bg-resume-totals',
            mapping: { external_id: 'external_id' },
            options: {},
            totals: {
              rows: rowCount,
              create: rowCount,
              update: 0,
              skip: 0,
              error: 0,
            },
            actorUserId: actor.id,
            rows,
          }),
        identity,
      );
      await runWithTenantContext(
        tenant.tenantId,
        async () => importService.applyJob(job.id),
        identity,
      );
      const deadline = Date.now() + 90_000;
      let applied = await tenantPrisma.importJob.findFirst({
        where: { id: job.id },
      });
      while (
        Date.now() < deadline &&
        applied?.status === ImportJobStatus.APPLYING
      ) {
        await importService.runImportWorkerAttempt({
          tenantId: tenant.tenantId,
          jobId: job.id,
          phase: 'apply',
        });
        applied = await tenantPrisma.importJob.findFirst({
          where: { id: job.id },
        });
      }
      expect(applied?.status).toBe(ImportJobStatus.APPLIED);
      const totals = applied?.totals_json as ImportJobTotals;
      const grouped = await totalsFromRowGroupBy(
        tenantPrisma,
        tenant.tenantId,
        job.id,
      );
      expect(totals.create).toBe(grouped.create);
      expect(totals.error).toBe(grouped.error);
      expect(
        totals.create + totals.error + totals.skip + totals.update,
      ).toBe(rowCount);
    }
  }, 120_000);

  it('logs apply_error, apply_seq_missing, and poison_cap with stored reasons', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const store = new ImportJobStore(prisma);
    const importService = app.get(ImportService);
    const actor = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    const identity = {
      userId: tenant.firebaseUid,
      email: tenant.email,
      role: 'ADMIN',
    };
    const errorJob = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.createDryRunJob({
          tenantId: tenant.tenantId,
          entityType: ImportEntityType.CUSTOMER,
          sourceSystem: 'legacy',
          fileSha256: 'sha-apply-error',
          mapping: { external_id: 'external_id' },
          options: {},
          totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
          actorUserId: actor.id,
          rows: [makeCustomerRow(1, ImportRowAction.CREATE, 'applyerr')],
        }),
      identity,
    );
    const db = prisma.client;
    const original = db.$transaction.bind(db);
    let transactions = 0;
    db.$transaction = ((...args: unknown[]) => {
      transactions += 1;
      if (transactions === 1) {
        return original(...(args as Parameters<typeof original>));
      }
      throw new Error('apply blew up');
    }) as typeof db.$transaction;
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    await expect(
      runWithTenantContext(
        tenant.tenantId,
        async () => importService.applyJob(errorJob.id),
        identity,
      ),
    ).rejects.toThrow('apply blew up');
    db.$transaction = original;
    const failedApply = await tenantPrisma.importJob.findFirst({
      where: { id: errorJob.id },
    });
    expect(
      (failedApply?.options_json as { apply_failure_reason?: string })
        .apply_failure_reason,
    ).toBe('apply_error');
    expect(
      errorLog.mock.calls.map((call) => String(call[0])).join('\n'),
    ).toContain(`import.job.failed jobId=${errorJob.id} phase=apply`);
    expect(
      errorLog.mock.calls.map((call) => String(call[0])).join('\n'),
    ).toContain('reason=apply_error cause=Error');

    const seqJob = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.createDryRunJob({
          tenantId: tenant.tenantId,
          entityType: ImportEntityType.CUSTOMER,
          sourceSystem: 'legacy',
          fileSha256: 'sha-seq-missing',
          mapping: { external_id: 'external_id' },
          options: {},
          totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
          actorUserId: actor.id,
          rows: [makeCustomerRow(1, ImportRowAction.CREATE, 'seqmiss')],
        }),
      identity,
    );
    await tenantPrisma.importJobRow.updateMany({
      where: { import_job_id: seqJob.id },
      data: { apply_seq: null },
    });
    await tenantPrisma.importJob.update({
      where: { id: seqJob.id },
      data: {
        status: ImportJobStatus.APPLYING,
        options_json: {
          worker: {
            phase: 'apply',
            lease_token: 'lease-seq-missing',
            lease_until: new Date(0).toISOString(),
            processed_rows: 0,
            last_committed_apply_seq: 0,
            started_at: new Date().toISOString(),
          },
        },
      },
    });
    await runWithTenantContext(
      tenant.tenantId,
      async () =>
        importService.runImportWorkerAttempt({
          tenantId: tenant.tenantId,
          jobId: seqJob.id,
          phase: 'apply',
        }),
      identity,
    );
    const seqFailed = await tenantPrisma.importJob.findFirst({
      where: { id: seqJob.id },
    });
    expect(seqFailed?.status).toBe(ImportJobStatus.FAILED);
    expect(
      (seqFailed?.options_json as { apply_failure_reason?: string })
        .apply_failure_reason,
    ).toBe('apply_seq_missing');
    expect(
      errorLog.mock.calls.map((call) => String(call[0])).join('\n'),
    ).toContain(`import.job.failed jobId=${seqJob.id} phase=apply`);
    expect(
      errorLog.mock.calls.map((call) => String(call[0])).join('\n'),
    ).toContain('reason=apply_seq_missing');

    const poisonJob = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.createDryRunJob({
          tenantId: tenant.tenantId,
          entityType: ImportEntityType.CUSTOMER,
          sourceSystem: 'legacy',
          fileSha256: 'sha-poison',
          mapping: { external_id: 'external_id' },
          options: {},
          totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
          actorUserId: actor.id,
          rows: [makeCustomerRow(1, ImportRowAction.CREATE, 'poison')],
        }),
      identity,
    );
    await tenantPrisma.importJobRow.updateMany({
      where: { import_job_id: poisonJob.id },
      data: { apply_seq: 1 },
    });
    await tenantPrisma.importJob.update({
      where: { id: poisonJob.id },
      data: {
        status: ImportJobStatus.APPLYING,
        attempts_without_progress:
          IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS - 1,
        options_json: {
          worker: {
            phase: 'apply',
            lease_token: 'lease-poison',
            lease_until: new Date(0).toISOString(),
            processed_rows: 0,
            last_committed_apply_seq: 0,
            claimed_processed_rows: 0,
            started_at: new Date().toISOString(),
          },
        },
      },
    });
    await runWithTenantContext(
      tenant.tenantId,
      async () =>
        importService.runImportWorkerAttempt({
          tenantId: tenant.tenantId,
          jobId: poisonJob.id,
          phase: 'apply',
        }),
      identity,
    );
    const poisoned = await tenantPrisma.importJob.findFirst({
      where: { id: poisonJob.id },
    });
    expect(poisoned?.status).toBe(ImportJobStatus.FAILED);
    expect(
      (poisoned?.options_json as { apply_failure_reason?: string })
        .apply_failure_reason,
    ).toBe('poison_cap');
    expect(
      errorLog.mock.calls.map((call) => String(call[0])).join('\n'),
    ).toContain(`import.job.failed jobId=${poisonJob.id} phase=apply`);
    expect(
      errorLog.mock.calls.map((call) => String(call[0])).join('\n'),
    ).toContain('reason=poison_cap');
    errorLog.mockRestore();
  });
});
