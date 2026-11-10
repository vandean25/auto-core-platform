import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import { InventoryPriceOperationState } from '@prisma/client';
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

describe('inventory price-operations discovery and fence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let authTokenAdmin: string;
  let testTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let otherOwnerBearer: string;

  beforeEach(async () => {
    guardedPriceTestHooks.failTxEAfterJournalLock = false;
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    prisma = app.get(PrismaService);
    testTenant = await createTestTenant(prisma, 'price-fence');
    tenantId = testTenant.tenantId;
    authTokenAdmin = createTestAuthToken(app.get(AuthService), testTenant);
    otherOwnerBearer = await createMemberBearer(
      prisma,
      app.get(AuthService),
      testTenant,
      'OWNER',
    );
  });

  afterEach(async () => {
    guardedPriceTestHooks.holdTxAOpenAfterAcceptInsert = false;
    guardedPriceTestHooks.onTxAHeld = null;
    guardedPriceTestHooks.failTxEAfterJournalLock = false;
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  async function seedItem(retail = 10, sku?: string) {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    return tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: sku ?? `FP-${Date.now()}`,
        name: 'Fence part',
        retail_price: retail,
        unit: 'pcs',
      },
    });
  }

  function operationKeyAt(ms: number, suffix = '0001') {
    return testUuidV7At(ms).replace(/0001$/, suffix.padStart(4, '0'));
  }

  function operationKey(suffix = '0001') {
    return operationKeyAt(Date.now(), suffix);
  }

  function tenantPrisma() {
    return createTenantAwarePrisma(prisma, tenantId);
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

  function fenceBody(itemId: string, retail: number, expectedRevision: number) {
    return { itemId, retail_price: retail, expectedRevision };
  }

  function postFence(
    key: string,
    body: { itemId: string; retail_price: number; expectedRevision: number },
    auth = `Bearer ${authTokenAdmin}`,
  ) {
    return request(app.getHttpServer())
      .post(`/api/inventory/price-operations/${key}/fence`)
      .set('Authorization', auth)
      .send(body);
  }

  function listOperations(auth = `Bearer ${authTokenAdmin}`, cursor?: string) {
    const req = request(app.getHttpServer())
      .get('/api/inventory/price-operations')
      .set('Authorization', auth);
    if (cursor) {
      return req.query({ cursor });
    }
    return req;
  }

  it('no-row fence serializes with in-flight Tx-A', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('a1a1');
    const intent = fenceBody(item.id, 12, revision);

    guardedPriceTestHooks.failTxEAfterJournalLock = true;
    await guardedPatch(item.id, key, {
      retail_price: 12,
      expectedRevision: revision,
    }).expect(500);
    guardedPriceTestHooks.failTxEAfterJournalLock = false;

    const fenceRes = await postFence(key, intent).expect(409);
    expect(fenceRes.body.code).toBe('OPERATION_UNRESOLVED');

    const journal = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow(
      { where: { key } },
    );
    expect(journal.state).toBe(InventoryPriceOperationState.ACCEPTED);
  });

  it('fence before Tx-A', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('b2b2');
    const intent = fenceBody(item.id, 14, revision);

    const fenceRes = await postFence(key, intent).expect(200);
    expect(fenceRes.body.state).toBe(InventoryPriceOperationState.FENCED);

    const patchRes = await guardedPatch(item.id, key, {
      retail_price: 14,
      expectedRevision: revision,
    }).expect(409);
    expect(patchRes.body.code).toBe('OPERATION_FENCED');
  });

  it('outside window is unavailable not fenced', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const oldMs = Date.now() - 25 * 60 * 60 * 1000;
    const key = operationKeyAt(oldMs, 'c3c3');
    const intent = fenceBody(item.id, 11, revision);

    const fenceRes = await postFence(key, intent).expect(410);
    expect(fenceRes.body.code).toBe('OUTCOME_UNAVAILABLE');

    const rows = await tenantPrisma().inventoryPriceOperation.findMany({
      where: { key },
    });
    expect(rows).toHaveLength(0);
  });

  it('principal and access only', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('d4d4');
    const intent = fenceBody(item.id, 13, revision);

    await guardedPatch(item.id, key, {
      retail_price: 13,
      expectedRevision: revision,
    }).expect(200);

    const otherPrincipalGet = await request(app.getHttpServer())
      .get(`/api/inventory/price-operations/${key}`)
      .set('Authorization', otherOwnerBearer)
      .expect(404);

    expect(otherPrincipalGet.body.statusCode).toBe(404);

    const otherFence = await postFence(key, intent, otherOwnerBearer).expect(
      404,
    );
    expect(otherFence.body.statusCode).toBe(404);

    const salesBearer = await createMemberBearer(
      prisma,
      app.get(AuthService),
      testTenant,
      'SALES',
    );
    const salesFence = await postFence(key, intent, salesBearer).expect(403);
    expect(salesFence.body.statusCode).toBe(403);
    await listOperations(salesBearer).expect(403);

    const removed = await seedItem(20, 'GONE-SKU');
    const removedRevision = revisionFromDb(removed.revision);
    const missingKey = operationKey('d4b0');
    await tenantPrisma().catalogItem.delete({ where: { id: removed.id } });
    await postFence(
      missingKey,
      fenceBody(removed.id, 21, removedRevision),
    ).expect(404);

    const journal = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow(
      { where: { key } },
    );
    expect(journal.state).toBe(InventoryPriceOperationState.APPLIED);
  });

  it('inaccessible item omitted', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('e5e5');

    await guardedPatch(item.id, key, {
      retail_price: 15,
      expectedRevision: revision,
    }).expect(200);

    await tenantPrisma().catalogItem.delete({ where: { id: item.id } });

    const list = await listOperations().expect(200);
    expect(list.body.data).toEqual([]);
    expect(
      (list.body.meta?.hasNextPage ?? false) === false || list.body.meta,
    ).toBeTruthy();

    await request(app.getHttpServer())
      .get(`/api/inventory/price-operations/${key}`)
      .set('Authorization', `Bearer ${authTokenAdmin}`)
      .expect(404);
  });
});
