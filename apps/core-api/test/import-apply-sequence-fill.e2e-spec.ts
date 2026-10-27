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
import { IMPORT_RECONCILE_GROUP_MAX_ROWS } from '../src/import/import-dry-run-group-limit.js';
import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from '../src/import/import-worker-handoff.constants.js';
import type { DryRunRowResult } from '../src/import/import.types.js';
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

  function makeCustomerRow(rowNo: number): DryRunRowResult {
    return {
      row_no: rowNo,
      external_id: `ext-${rowNo}`,
      action: ImportRowAction.CREATE,
      entity_id: null,
      errors: [],
      warnings: [],
      normalized: { external_id: `ext-${rowNo}` },
    };
  }

  it('persists one reconcile unit within transaction timeouts', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const store = new ImportJobStore(prisma);
    const actor = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    const rowCount = IMPORT_RECONCILE_GROUP_MAX_ROWS;
    const rows = Array.from({ length: rowCount }, (_, index) =>
      makeCustomerRow(index + 1),
    );
    const job = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.createDryRunJob({
          tenantId: tenant.tenantId,
          entityType: ImportEntityType.CUSTOMER,
          sourceSystem: 'legacy',
          fileSha256: 'sha-reconcile',
          mapping: {},
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
      { userId: actor.id },
    );
    const leaseToken = 'lease-reconcile-e2e';
    await runWithTenantContext(
      tenant.tenantId,
      async () =>
        prisma.importJob.update({
          where: { id: job.id, tenant_id: tenant.tenantId },
          data: {
            status: ImportJobStatus.APPLYING,
            options_json: {
              worker: {
                phase: 'dry_run',
                lease_token: leaseToken,
                lease_until: new Date(Date.now() + 60_000).toISOString(),
                processed_rows: rowCount,
                started_at: new Date().toISOString(),
                dry_run_reconcile_active: true,
                dry_run_reconcile_cursor: 0,
                dry_run_reconcile_units: [
                  {
                    context_from_row: 1,
                    context_to_row: rowCount,
                    replan_row_nos: rows.map((row) => row.row_no),
                  },
                ],
              },
            },
          },
        }),
      { userId: actor.id },
    );
    const replanned = rows.map((row) => ({
      ...row,
      action: ImportRowAction.UPDATE,
      entity_id: 'entity-1',
    }));
    const started = performance.now();
    const persisted = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.persistDryRunReconcileChunk(
          tenant.tenantId,
          job.id,
          replanned,
          { dry_run_reconcile_cursor: 1 },
          (await store.findJob(tenant.tenantId, job.id))!
            .options_json as never,
          leaseToken,
        ),
      { userId: actor.id },
    );
    const elapsedMs = performance.now() - started;
    console.info(
      `reconcile unit persist elapsedMs=${Math.round(elapsedMs)}`,
    );
    expect(persisted).not.toBeNull();
    expect(elapsedMs).toBeLessThan(10_000);
    const updated = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
      select: { action: true },
    });
    expect(updated.every((row) => row.action === ImportRowAction.UPDATE)).toBe(
      true,
    );
  });

  it('does not write a partial reconcile unit when the lease is lost', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const store = new ImportJobStore(prisma);
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
          fileSha256: 'sha-lease',
          mapping: {},
          options: {},
          totals: { rows: 3, create: 3, update: 0, skip: 0, error: 0 },
          actorUserId: actor.id,
          rows,
        }),
      { userId: actor.id },
    );
    const leaseToken = 'lease-ok';
    await runWithTenantContext(
      tenant.tenantId,
      async () =>
        prisma.importJob.update({
          where: { id: job.id, tenant_id: tenant.tenantId },
          data: {
            status: ImportJobStatus.APPLYING,
            options_json: {
              worker: {
                phase: 'dry_run',
                lease_token: leaseToken,
                lease_until: new Date(Date.now() + 60_000).toISOString(),
                processed_rows: 3,
                started_at: new Date().toISOString(),
                dry_run_reconcile_active: true,
                dry_run_reconcile_cursor: 0,
                dry_run_reconcile_units: [
                  {
                    context_from_row: 1,
                    context_to_row: 2,
                    replan_row_nos: [1, 2],
                  },
                  {
                    context_from_row: 3,
                    context_to_row: 3,
                    replan_row_nos: [3],
                  },
                ],
              },
            },
          },
        }),
      { userId: actor.id },
    );
    await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.persistDryRunReconcileChunk(
          tenant.tenantId,
          job.id,
          [makeCustomerRow(1), makeCustomerRow(2)].map((row) => ({
            ...row,
            action: ImportRowAction.UPDATE,
          })),
          { dry_run_reconcile_cursor: 1 },
          (await store.findJob(tenant.tenantId, job.id))!
            .options_json as never,
          leaseToken,
        ),
      { userId: actor.id },
    );
    const lost = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.persistDryRunReconcileChunk(
          tenant.tenantId,
          job.id,
          [makeCustomerRow(3)].map((row) => ({
            ...row,
            action: ImportRowAction.UPDATE,
          })),
          { dry_run_reconcile_cursor: 2 },
          (await store.findJob(tenant.tenantId, job.id))!
            .options_json as never,
          'wrong-lease',
        ),
      { userId: actor.id },
    );
    expect(lost).toBeNull();
    const persisted = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
      orderBy: { row_no: 'asc' },
      select: { row_no: true, action: true },
    });
    expect(persisted.filter((row) => row.action === ImportRowAction.UPDATE)).toHaveLength(
      2,
    );
    expect(persisted.filter((row) => row.action === ImportRowAction.CREATE)).toHaveLength(
      1,
    );
  });

  it('resumes reconcile from the committed cursor without rewriting rows twice', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const store = new ImportJobStore(prisma);
    const actor = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    const rows = [
      makeCustomerRow(1),
      makeCustomerRow(2),
      makeCustomerRow(3),
      makeCustomerRow(4),
    ];
    const job = await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.createDryRunJob({
          tenantId: tenant.tenantId,
          entityType: ImportEntityType.CUSTOMER,
          sourceSystem: 'legacy',
          fileSha256: 'sha-resume',
          mapping: {},
          options: {},
          totals: { rows: 4, create: 4, update: 0, skip: 0, error: 0 },
          actorUserId: actor.id,
          rows,
        }),
      { userId: actor.id },
    );
    const leaseToken = 'lease-resume';
    await runWithTenantContext(
      tenant.tenantId,
      async () =>
        prisma.importJob.update({
          where: { id: job.id, tenant_id: tenant.tenantId },
          data: {
            status: ImportJobStatus.APPLYING,
            options_json: {
              worker: {
                phase: 'dry_run',
                lease_token: leaseToken,
                lease_until: new Date(Date.now() + 60_000).toISOString(),
                processed_rows: 4,
                started_at: new Date().toISOString(),
                dry_run_reconcile_active: true,
                dry_run_reconcile_cursor: 0,
                dry_run_reconcile_units: [
                  {
                    context_from_row: 1,
                    context_to_row: 2,
                    replan_row_nos: [1, 2],
                  },
                  {
                    context_from_row: 3,
                    context_to_row: 4,
                    replan_row_nos: [3, 4],
                  },
                ],
              },
            },
          },
        }),
      { userId: actor.id },
    );
    const replannedUnitOne = [1, 2].map((rowNo) => ({
      ...makeCustomerRow(rowNo),
      action: ImportRowAction.UPDATE,
      entity_id: `entity-${rowNo}`,
    }));
    await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.persistDryRunReconcileChunk(
          tenant.tenantId,
          job.id,
          replannedUnitOne,
          { dry_run_reconcile_cursor: 1 },
          (await store.findJob(tenant.tenantId, job.id))!
            .options_json as never,
          leaseToken,
        ),
      { userId: actor.id },
    );
    const afterFirst = await tenantPrisma.importJob.findFirst({
      where: { id: job.id },
    });
    expect(
      (afterFirst!.options_json as { worker?: { dry_run_reconcile_cursor?: number } })
        .worker?.dry_run_reconcile_cursor,
    ).toBe(1);
    const rowsAfterFirst = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
      orderBy: { row_no: 'asc' },
      select: { row_no: true, action: true, entity_id: true },
    });
    expect(rowsAfterFirst.filter((row) => row.action === ImportRowAction.UPDATE)).toHaveLength(2);
    expect(rowsAfterFirst.filter((row) => row.action === ImportRowAction.CREATE)).toHaveLength(2);
    const resumedOptions = (await runWithTenantContext(
      tenant.tenantId,
      async () => store.findJob(tenant.tenantId, job.id),
      { userId: actor.id },
    ))!.options_json as never;
    const replannedUnitTwo = [3, 4].map((rowNo) => ({
      ...makeCustomerRow(rowNo),
      action: ImportRowAction.UPDATE,
      entity_id: `entity-${rowNo}`,
    }));
    await runWithTenantContext(
      tenant.tenantId,
      async () =>
        store.persistDryRunReconcileChunk(
          tenant.tenantId,
          job.id,
          replannedUnitTwo,
          { dry_run_reconcile_cursor: 2 },
          resumedOptions,
          leaseToken,
          {
            expectedRows: 4,
            optionsForPersist: {},
          },
        ),
      { userId: actor.id },
    );
    const rowsFinal = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
      orderBy: { row_no: 'asc' },
      select: { row_no: true, action: true, entity_id: true },
    });
    expect(rowsFinal.every((row) => row.action === ImportRowAction.UPDATE)).toBe(true);
    expect(rowsFinal.map((row) => row.entity_id)).toEqual([
      'entity-1',
      'entity-2',
      'entity-3',
      'entity-4',
    ]);
    const finished = await tenantPrisma.importJob.findFirst({
      where: { id: job.id },
    });
    expect(finished?.status).toBe(ImportJobStatus.DRY_RUN_DONE);
  });
});
