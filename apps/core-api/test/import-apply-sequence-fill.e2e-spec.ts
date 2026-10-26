import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ImportJobStore } from '../src/import/import-job.store.js';
import { orderVehiclePartyApplyRows } from '../src/import/vehicle-party-import.apply-order.js';
import { toImportApplyRow } from '../src/import/import-job.store.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('import apply_seq fill (e2e)', () => {
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
    tenant = await createTestTenant(prisma, 'import-apply-seq');
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, prisma);
  });

  it('fills row_no and updates_first apply_seq in the database', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const store = new ImportJobStore(prisma);
    const dryRunRows = [
      {
        row_no: 1,
        external_id: 'a',
        action: ImportRowAction.CREATE,
        entity_id: null,
        errors: [],
        warnings: [],
        normalized: { external_id: 'a' },
      },
      {
        row_no: 2,
        external_id: 'b',
        action: ImportRowAction.UPDATE,
        entity_id: 'x',
        errors: [],
        warnings: [],
        normalized: { external_id: 'b' },
      },
      {
        row_no: 3,
        external_id: 'c',
        action: ImportRowAction.UPDATE,
        entity_id: 'y',
        errors: [],
        warnings: [],
        normalized: { external_id: 'c' },
      },
    ];
    const actor = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    const job = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.createDryRunJob({
          tenantId: tenant.tenantId,
          entityType: ImportEntityType.VEHICLE_PARTY,
          sourceSystem: 'legacy',
          fileSha256: 'sha',
          mapping: {},
          options: {},
          totals: { rows: 3, create: 1, update: 2, skip: 0, error: 0 },
          actorUserId: actor.id,
          rows: dryRunRows,
        }),
      { userId: actor.id },
    );
    await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.lockForBackgroundApply(
          tenant.tenantId,
          job.id,
          {},
          { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
          'updates_first',
        ),
      { userId: actor.id },
    );
    const loaded = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
      orderBy: { row_no: 'asc' },
    });
    const applyRows = loaded.map(toImportApplyRow);
    const expectedOrder = orderVehiclePartyApplyRows(applyRows).map(
      (row) => row.row_no,
    );
    const seqOrder = [...applyRows]
      .sort((a, b) => (a.apply_seq ?? 0) - (b.apply_seq ?? 0))
      .map((row) => row.row_no);
    expect(seqOrder).toEqual(expectedOrder);
    const refreshed = await tenantPrisma.importJob.findFirst({
      where: { id: job.id },
    });
    expect(refreshed?.status).toBe(ImportJobStatus.APPLYING);
    expect(applyRows.every((row) => row.apply_seq != null)).toBe(true);
  });
});
