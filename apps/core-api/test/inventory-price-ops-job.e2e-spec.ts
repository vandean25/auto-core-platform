import { INestApplication, Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { InventoryPriceOperationState } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { GUARDED_PRICE_RETENTION_MS } from '../src/inventory/guarded-price/guarded-price.constants.js';
import { GUARDED_PRICE_KIND } from '../src/inventory/guarded-price/guarded-price.errors.js';
import { revisionFromDb } from '../src/inventory/guarded-price/guarded-price.revision.js';
import {
  guardedPriceTestHooks,
  releaseHeldTxE,
} from '../src/inventory/guarded-price/guarded-price-test-hooks.js';
import { testUuidV7At } from '../src/inventory/guarded-price/guarded-price.test-keys.js';
import { GuardedPriceOpsJobService } from '../src/inventory/guarded-price/guarded-price-ops-job.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import { guardedPricePatchRequest } from './helpers/guarded-price-patch-request.js';
import { updatePriceOperationAcceptedAt } from './helpers/inventory-price-fence-discovery.e2e-helpers.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('inventory price-operations system fence & retention job (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobService: GuardedPriceOpsJobService;
  let tenantId: string;
  let authTokenAdmin: string;
  let testTenant: Awaited<ReturnType<typeof createTestTenant>>;

  beforeEach(async () => {
    guardedPriceTestHooks.failTxEAfterJournalLock = false;
    guardedPriceTestHooks.holdTxEOpenAfterJournalLock = false;
    guardedPriceTestHooks.onTxEJournalLocked = null;

    app = await createE2eApp(undefined, { productionErrorFilter: true });
    prisma = app.get(PrismaService);
    jobService = app.get(GuardedPriceOpsJobService);
    testTenant = await createTestTenant(prisma, 'price-ops-job');
    tenantId = testTenant.tenantId;
    authTokenAdmin = createTestAuthToken(app.get(AuthService), testTenant);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    guardedPriceTestHooks.failTxEAfterJournalLock = false;
    guardedPriceTestHooks.holdTxEOpenAfterJournalLock = false;
    guardedPriceTestHooks.onTxEJournalLocked = null;
    releaseHeldTxE();
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  function tenantPrisma() {
    return createTenantAwarePrisma(prisma, tenantId);
  }

  function operationKeyAt(ms: number, suffix: string) {
    return testUuidV7At(ms).replace(/0001$/, suffix.padStart(4, '0'));
  }

  async function seedItem(retail = 10, sku?: string) {
    return tenantPrisma().catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: sku ?? `JOB-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        name: 'Job part',
        retail_price: retail,
        unit: 'pcs',
      },
    });
  }

  it('system fence after 24h', async () => {
    const item = await seedItem(10);
    const freshItem = await seedItem(10);
    const now = new Date();
    const olderThan24h = new Date(now.getTime() - (24 * 60 + 1) * 60 * 1000);
    const within24h = new Date(now.getTime() - 23 * 60 * 60 * 1000);

    const staleKey = operationKeyAt(olderThan24h.getTime(), '1001');
    const freshKey = operationKeyAt(within24h.getTime(), '1002');
    const appliedKey = operationKeyAt(olderThan24h.getTime(), '1003');
    const appliedFinalAt = new Date(olderThan24h.getTime() + 1000);

    await tenantPrisma().inventoryPriceOperation.createMany({
      data: [
        {
          tenant_id: tenantId,
          principal_id: testTenant.firebaseUid,
          key: staleKey,
          item_id: item.id,
          sku: item.sku,
          kind: GUARDED_PRICE_KIND,
          expected_revision: BigInt(1),
          target_minor: BigInt(1500),
          basis_minor: BigInt(1000),
          state: InventoryPriceOperationState.ACCEPTED,
          accepted_at: olderThan24h,
        },
        {
          tenant_id: tenantId,
          principal_id: testTenant.firebaseUid,
          key: freshKey,
          item_id: freshItem.id,
          sku: freshItem.sku,
          kind: GUARDED_PRICE_KIND,
          expected_revision: BigInt(1),
          target_minor: BigInt(1600),
          basis_minor: BigInt(1000),
          state: InventoryPriceOperationState.ACCEPTED,
          accepted_at: within24h,
        },
        {
          tenant_id: tenantId,
          principal_id: testTenant.firebaseUid,
          key: appliedKey,
          item_id: item.id,
          sku: item.sku,
          kind: GUARDED_PRICE_KIND,
          expected_revision: BigInt(1),
          target_minor: BigInt(1700),
          basis_minor: BigInt(1000),
          state: InventoryPriceOperationState.APPLIED,
          accepted_at: olderThan24h,
          final_at: appliedFinalAt,
          result_revision: BigInt(2),
        },
      ],
    });

    const report = await jobService.runSweep(now);
    expect(report.fencedCount).toBeGreaterThanOrEqual(1);

    const fencedRow = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow({
      where: { key: staleKey },
    });
    expect(fencedRow.state).toBe(InventoryPriceOperationState.FENCED);
    expect(fencedRow.error_code).toBe('OPERATION_FENCED');
    expect(fencedRow.final_at).not.toBeNull();

    const freshRow = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow({
      where: { key: freshKey },
    });
    expect(freshRow.state).toBe(InventoryPriceOperationState.ACCEPTED);
    expect(freshRow.final_at).toBeNull();

    const appliedRow = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow({
      where: { key: appliedKey },
    });
    expect(appliedRow.state).toBe(InventoryPriceOperationState.APPLIED);
    expect(appliedRow.final_at?.getTime()).toBe(appliedFinalAt.getTime());
    expect(appliedRow.result_revision).toBe(BigInt(2));
  });

  it('job loses to in-flight Tx-E', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const key = operationKeyAt(Date.now(), '2001');

    guardedPriceTestHooks.failTxEAfterJournalLock = true;
    await guardedPricePatchRequest(
      app,
      item.id,
      key,
      { retail_price: 25, expectedRevision: revision },
      `Bearer ${authTokenAdmin}`,
    ).expect(500);
    guardedPriceTestHooks.failTxEAfterJournalLock = false;

    const olderThan24h = new Date(Date.now() - (24 * 60 + 5) * 60 * 1000);
    await updatePriceOperationAcceptedAt(
      {
        tenantId,
        principalId: testTenant.firebaseUid,
        tenantPrisma,
        seedItem,
        operationKeyAt,
      },
      key,
      olderThan24h,
    );

    guardedPriceTestHooks.holdTxEOpenAfterJournalLock = true;
    const txEHeld = new Promise<void>((resolve) => {
      guardedPriceTestHooks.onTxEJournalLocked = () => resolve();
    });

    const patchPromise = guardedPricePatchRequest(
      app,
      item.id,
      key,
      { retail_price: 25, expectedRevision: revision },
      `Bearer ${authTokenAdmin}`,
    ).then((res) => res);

    await txEHeld;

    try {
      await jobService.runSweep(new Date());
    } finally {
      releaseHeldTxE();
    }

    const patchRes = await patchPromise;
    expect(patchRes.status).toBe(200);

    const journal = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow({
      where: { key },
    });
    expect(journal.state).toBe(InventoryPriceOperationState.APPLIED);

    const updatedItem = await tenantPrisma().catalogItem.findFirstOrThrow({
      where: { id: item.id },
    });
    expect(Number(updatedItem.retail_price)).toBe(25);
  });

  it('retention deletes final only', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const now = new Date();
    const expiredMs = now.getTime() - GUARDED_PRICE_RETENTION_MS - 60 * 60 * 1000;
    const recentMs = now.getTime() - GUARDED_PRICE_RETENTION_MS + 24 * 60 * 60 * 1000;
    const acceptedWithin24h = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const expiredAppliedKey = operationKeyAt(expiredMs, '3001');
    const futureKeyTimeNotExpiredKey = operationKeyAt(recentMs, '3002');
    const recentFinalKey = operationKeyAt(recentMs, '3003');
    const acceptedKey = operationKeyAt(acceptedWithin24h.getTime(), '3004');

    await tenantPrisma().inventoryPriceOperation.createMany({
      data: [
        {
          tenant_id: tenantId,
          principal_id: testTenant.firebaseUid,
          key: expiredAppliedKey,
          item_id: item.id,
          sku: item.sku,
          kind: GUARDED_PRICE_KIND,
          expected_revision: BigInt(revision),
          target_minor: BigInt(1200),
          basis_minor: BigInt(1000),
          state: InventoryPriceOperationState.APPLIED,
          accepted_at: new Date(expiredMs),
          final_at: new Date(expiredMs),
          result_revision: BigInt(revision + 1),
        },
        {
          tenant_id: tenantId,
          principal_id: testTenant.firebaseUid,
          key: futureKeyTimeNotExpiredKey,
          item_id: item.id,
          sku: item.sku,
          kind: GUARDED_PRICE_KIND,
          expected_revision: BigInt(revision),
          target_minor: BigInt(1300),
          basis_minor: BigInt(1000),
          state: InventoryPriceOperationState.FENCED,
          accepted_at: new Date(expiredMs),
          final_at: new Date(expiredMs),
          error_code: 'OPERATION_FENCED',
        },
        {
          tenant_id: tenantId,
          principal_id: testTenant.firebaseUid,
          key: recentFinalKey,
          item_id: item.id,
          sku: item.sku,
          kind: GUARDED_PRICE_KIND,
          expected_revision: BigInt(revision),
          target_minor: BigInt(1400),
          basis_minor: BigInt(1000),
          state: InventoryPriceOperationState.CONFLICT,
          accepted_at: new Date(recentMs),
          final_at: new Date(recentMs),
          error_code: 'INVENTORY_REVISION_CONFLICT',
        },
        {
          tenant_id: tenantId,
          principal_id: testTenant.firebaseUid,
          key: acceptedKey,
          item_id: item.id,
          sku: item.sku,
          kind: GUARDED_PRICE_KIND,
          expected_revision: BigInt(revision),
          target_minor: BigInt(1500),
          basis_minor: BigInt(1000),
          state: InventoryPriceOperationState.ACCEPTED,
          accepted_at: acceptedWithin24h,
        },
      ],
    });

    const report = await jobService.runSweep(now);
    expect(report.deletedCount).toBeGreaterThanOrEqual(1);

    expect(
      await tenantPrisma().inventoryPriceOperation.findFirst({
        where: { key: expiredAppliedKey },
      }),
    ).toBeNull();
    expect(
      await tenantPrisma().inventoryPriceOperation.findFirst({
        where: { key: futureKeyTimeNotExpiredKey },
      }),
    ).not.toBeNull();
    expect(
      await tenantPrisma().inventoryPriceOperation.findFirst({
        where: { key: recentFinalKey },
      }),
    ).not.toBeNull();
    expect(
      await tenantPrisma().inventoryPriceOperation.findFirst({
        where: { key: acceptedKey },
      }),
    ).not.toBeNull();

    const fenceAfterRetention = await request(app.getHttpServer())
      .post(`/api/inventory/price-operations/${expiredAppliedKey}/fence`)
      .set('Authorization', `Bearer ${authTokenAdmin}`)
      .send({
        itemId: item.id,
        retail_price: 12,
        expectedRevision: revision,
      });
    expect(fenceAfterRetention.status).toBe(410);
    expect(fenceAfterRetention.body.code).toBe('OUTCOME_UNAVAILABLE');
  });

  it('stale accepted alert', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const key = operationKeyAt(Date.now(), '4001');

    guardedPriceTestHooks.failTxEAfterJournalLock = true;
    await guardedPricePatchRequest(
      app,
      item.id,
      key,
      { retail_price: 30, expectedRevision: revision },
      `Bearer ${authTokenAdmin}`,
    ).expect(500);
    guardedPriceTestHooks.failTxEAfterJournalLock = false;

    const olderThan25h = new Date(Date.now() - (25 * 60 + 5) * 60 * 1000);
    await updatePriceOperationAcceptedAt(
      {
        tenantId,
        principalId: testTenant.firebaseUid,
        tenantPrisma,
        seedItem,
        operationKeyAt,
      },
      key,
      olderThan25h,
    );

    guardedPriceTestHooks.holdTxEOpenAfterJournalLock = true;
    const txEHeld = new Promise<void>((resolve) => {
      guardedPriceTestHooks.onTxEJournalLocked = () => resolve();
    });

    const patchPromise = guardedPricePatchRequest(
      app,
      item.id,
      key,
      { retail_price: 30, expectedRevision: revision },
      `Bearer ${authTokenAdmin}`,
    ).then((res) => res);

    await txEHeld;
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    let report: Awaited<ReturnType<GuardedPriceOpsJobService['runSweep']>>;
    try {
      report = await jobService.runSweep(new Date());
    } finally {
      releaseHeldTxE();
      await patchPromise;
    }

    expect(report.staleAcceptedCount).toBeGreaterThanOrEqual(1);
    expect(report.staleAlertEmitted).toBe(true);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('25h'),
    );
  });
});
