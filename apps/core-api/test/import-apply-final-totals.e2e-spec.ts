import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
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
    if (group.action === ImportRowAction.CREATE) tallied.create = group._count._all;
    if (group.action === ImportRowAction.UPDATE) tallied.update = group._count._all;
    if (group.action === ImportRowAction.SKIP) tallied.skip = group._count._all;
    if (group.action === ImportRowAction.ERROR) tallied.error = group._count._all;
  }
  return tallied;
}

function makeCustomerRow(
  rowNo: number,
  action: ImportRowAction = ImportRowAction.CREATE,
): DryRunRowResult {
  return {
    row_no: rowNo,
    external_id: `ext-${rowNo}`,
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
});
