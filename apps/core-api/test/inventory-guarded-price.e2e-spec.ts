import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import { AuditLogAction, InventoryPriceOperationState } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createMemberBearer,
  createTestAuthToken,
  createTestTenant,
  createTenantAwarePrisma,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { testUuidV7At } from '../src/inventory/guarded-price/guarded-price.test-keys.js';
import { guardedPriceTestHooks } from '../src/inventory/guarded-price/guarded-price-test-hooks.js';
import { revisionFromDb } from '../src/inventory/guarded-price/guarded-price.revision.js';
import { DashboardRealtimeService } from '../src/dashboard-realtime/dashboard-realtime.service.js';

describe('inventory guarded price PATCH (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let authTokenAdmin: string;
  let testTenant: Awaited<ReturnType<typeof createTestTenant>>;

  beforeEach(async () => {
    guardedPriceTestHooks.failTxEAfterJournalLock = false;
    guardedPriceTestHooks.failTxEAfterCatalogUpdate = false;
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    prisma = app.get(PrismaService);
    testTenant = await createTestTenant(prisma, 'guarded-price');
    tenantId = testTenant.tenantId;
    authTokenAdmin = createTestAuthToken(app.get(AuthService), testTenant);
  });

  afterEach(async () => {
    guardedPriceTestHooks.failTxEAfterJournalLock = false;
    guardedPriceTestHooks.failTxEAfterCatalogUpdate = false;
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  async function seedItem(retail = 10) {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    return tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: `GP-${Date.now()}`,
        name: 'Guarded price part',
        retail_price: retail,
        unit: 'pcs',
      },
    });
  }

  function operationKey(suffix = '1') {
    return testUuidV7At(Date.now()).replace(/0001$/, suffix.padStart(4, '0'));
  }

  function tenantPrisma() {
    return createTenantAwarePrisma(prisma, tenantId);
  }

  async function catalogRow(itemId: string) {
    return tenantPrisma().catalogItem.findFirstOrThrow({
      where: { id: itemId },
    });
  }

  function guardedPatch(
    itemId: string,
    key: string,
    body: { retail_price: number; expectedRevision: number },
    auth = `Bearer ${authTokenAdmin}`,
  ) {
    return request(app.getHttpServer())
      .patch(`/api/inventory/${itemId}`)
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);
  }

  it('applied atomically', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const key = operationKey();

    const response = await guardedPatch(
      item.id,
      key,
      { retail_price: 12.5, expectedRevision: revision },
    ).expect(200);

    expect(Number(response.body.retail_price)).toBe(12.5);
    expect(response.body.revision).toBeGreaterThan(revision);

    const row = await catalogRow(item.id);
    expect(Number(row.retail_price)).toBe(12.5);

    const audits = await tenantPrisma().auditLog.findMany({
      where: { entity_id: item.id, source: 'inventory.guarded_price' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe(AuditLogAction.UPDATE);

    const journal = await tenantPrisma().inventoryPriceOperation.findFirst({
      where: { key, state: InventoryPriceOperationState.APPLIED },
    });
    expect(journal).toBeTruthy();
  });

  it('conflict commits only proof', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const key = operationKey('2');

    const stale = await guardedPatch(item.id, key, {
      retail_price: 11,
      expectedRevision: revision - 1,
    }).expect(409);

    expect(stale.body.code).toBe('INVENTORY_REVISION_CONFLICT');

    const row = await catalogRow(item.id);
    expect(Number(row.retail_price)).toBe(10);

    const audits = await tenantPrisma().auditLog.findMany({
      where: { entity_id: item.id, source: 'inventory.guarded_price' },
    });
    expect(audits).toHaveLength(0);

    const journal = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow({
      where: { key },
    });
    expect(journal.state).toBe(InventoryPriceOperationState.CONFLICT);
  });

  it('same key replays stored outcome', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const key = operationKey('3');

    const first = await guardedPatch(item.id, key, {
      retail_price: 15,
      expectedRevision: revision,
    }).expect(200);

    const storedRevision = first.body.revision;

    await tenantPrisma().catalogItem.update({
      where: { id: item.id },
      data: { retail_price: 99 },
    });

    const replay = await guardedPatch(item.id, key, {
      retail_price: 15,
      expectedRevision: revision,
    }).expect(200);

    expect(Number(replay.body.retail_price)).toBe(15);
    expect(replay.body.revision).toBe(storedRevision);

    const rows = await tenantPrisma().inventoryPriceOperation.findMany({
      where: { key },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe(InventoryPriceOperationState.APPLIED);
  });

  it('replay after item deletion returns OUTCOME_UNAVAILABLE', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const key = operationKey('3b');

    await guardedPatch(item.id, key, {
      retail_price: 15,
      expectedRevision: revision,
    }).expect(200);

    await tenantPrisma().catalogItem.delete({ where: { id: item.id } });

    const replay = await guardedPatch(item.id, key, {
      retail_price: 15,
      expectedRevision: revision,
    }).expect(410);

    expect(replay.body.code).toBe('OUTCOME_UNAVAILABLE');
  });

  it('overlapping guarded updates: one APPLIED, one CONFLICT, first price kept', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const keyA = operationKey('9');
    const keyB = operationKey('8');

    await guardedPatch(item.id, keyA, {
      retail_price: 11,
      expectedRevision: revision,
    }).expect(200);

    const second = await guardedPatch(item.id, keyB, {
      retail_price: 12,
      expectedRevision: revision,
    }).expect(409);

    expect(second.body.code).toBe('INVENTORY_REVISION_CONFLICT');

    const row = await catalogRow(item.id);
    expect(Number(row.retail_price)).toBe(11);

    const journals = await tenantPrisma().inventoryPriceOperation.findMany({
      where: { item_id: item.id },
    });
    expect(journals).toHaveLength(2);
    const states = new Set(journals.map((j) => j.state));
    expect(states.has(InventoryPriceOperationState.APPLIED)).toBe(true);
    expect(states.has(InventoryPriceOperationState.CONFLICT)).toBe(true);
  });

  it('successful apply emits one realtime update', async () => {
    const realtime = app.get(DashboardRealtimeService);
    const emitSpy = jest.spyOn(realtime, 'emitEntityUpdated');

    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const key = operationKey('6');

    emitSpy.mockClear();
    await guardedPatch(item.id, key, {
      retail_price: 14,
      expectedRevision: revision,
    }).expect(200);

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        type: 'CATALOG_ITEM',
        action: 'UPDATED',
        entityId: item.id,
      }),
    );
  });

  it('rollback after catalog update emits no realtime event', async () => {
    const realtime = app.get(DashboardRealtimeService);
    const emitSpy = jest.spyOn(realtime, 'emitEntityUpdated');
    guardedPriceTestHooks.failTxEAfterCatalogUpdate = true;

    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const key = operationKey('7');

    emitSpy.mockClear();
    await guardedPatch(item.id, key, {
      retail_price: 16,
      expectedRevision: revision,
    }).expect(500);

    expect(emitSpy).not.toHaveBeenCalled();

    const row = await catalogRow(item.id);
    expect(Number(row.retail_price)).toBe(10);
  });

  it('unauthorized writes nothing', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const salesBearer = await createMemberBearer(
      prisma,
      app.get(AuthService),
      testTenant,
      'SALES',
    );
    const key = operationKey('4');

    const response = await guardedPatch(
      item.id,
      key,
      { retail_price: 20, expectedRevision: revision },
      salesBearer,
    ).expect(403);

    expect(response.body.message).toMatch(/OWNER|ADMIN/i);

    const journal = await tenantPrisma().inventoryPriceOperation.findMany({
      where: { key },
    });
    expect(journal).toHaveLength(0);
  });

  it('same key retries to completion after Tx-E rollback', async () => {
    const item = await seedItem(10);
    const revision = revisionFromDb(item.revision);
    const key = operationKey('5');
    guardedPriceTestHooks.failTxEAfterJournalLock = true;

    await guardedPatch(item.id, key, {
      retail_price: 18,
      expectedRevision: revision,
    }).expect(500);

    guardedPriceTestHooks.failTxEAfterJournalLock = false;

    const response = await guardedPatch(item.id, key, {
      retail_price: 18,
      expectedRevision: revision,
    }).expect(200);

    expect(Number(response.body.retail_price)).toBe(18);

    const journal = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow({
      where: { key },
    });
    expect(journal.state).toBe(InventoryPriceOperationState.APPLIED);

    const row = await catalogRow(item.id);
    expect(Number(row.retail_price)).toBe(18);
  });
});
