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
import { guardedPricePatchRequest } from './helpers/guarded-price-patch-request.js';
import { testUuidV7At } from '../src/inventory/guarded-price/guarded-price.test-keys.js';
import {
  guardedPriceTestHooks,
  releaseHeldTxE,
  releaseHeldTxECatalog,
} from '../src/inventory/guarded-price/guarded-price-test-hooks.js';
import { revisionFromDb } from '../src/inventory/guarded-price/guarded-price.revision.js';
import { GUARDED_PRICE_RETENTION_MS } from '../src/inventory/guarded-price/guarded-price.constants.js';
import { encodePriceOperationDiscoveryCursor } from '../src/inventory/guarded-price/guarded-price-discovery-cursor.js';
import { GUARDED_PRICE_KIND } from '../src/inventory/guarded-price/guarded-price.errors.js';

describe('inventory price-operations discovery and fence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let authTokenAdmin: string;
  let testTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let otherOwnerBearer: string;

  beforeEach(async () => {
    guardedPriceTestHooks.failTxEAfterJournalLock = false;
    guardedPriceTestHooks.holdTxEOpenAfterJournalLock = false;
    guardedPriceTestHooks.holdTxEOpenAfterCatalogUpdate = false;
    guardedPriceTestHooks.onTxEJournalLocked = null;
    guardedPriceTestHooks.onTxECatalogUpdated = null;
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
    guardedPriceTestHooks.failTxEAfterJournalLock = false;
    guardedPriceTestHooks.holdTxEOpenAfterJournalLock = false;
    guardedPriceTestHooks.holdTxEOpenAfterCatalogUpdate = false;
    guardedPriceTestHooks.onTxEJournalLocked = null;
    guardedPriceTestHooks.onTxECatalogUpdated = null;
    releaseHeldTxE();
    releaseHeldTxECatalog();
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
    return guardedPricePatchRequest(app, itemId, key, body, auth);
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

  function listOperations(auth?: string, cursor?: string) {
    const req = request(app.getHttpServer())
      .get('/api/inventory/price-operations')
      .set('Authorization', auth ?? `Bearer ${authTokenAdmin}`);
    if (cursor) {
      return req.query({ cursor });
    }
    return req;
  }

  function getOperation(key: string, auth = `Bearer ${authTokenAdmin}`) {
    return request(app.getHttpServer())
      .get(`/api/inventory/price-operations/${key}`)
      .set('Authorization', auth);
  }

  it('no-row fence serializes with in-flight Tx-A', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('a1a1');
    const intent = fenceBody(item.id, 12, revision);

    guardedPriceTestHooks.holdTxEOpenAfterJournalLock = true;
    const txEHeld = new Promise<void>((resolve) => {
      guardedPriceTestHooks.onTxEJournalLocked = () => resolve();
    });

    const patchPromise = guardedPatch(item.id, key, {
      retail_price: 12,
      expectedRevision: revision,
    }).then((res) => res);

    await txEHeld;
    const heldRow = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow(
      { where: { key } },
    );
    expect(heldRow.state).toBe(InventoryPriceOperationState.ACCEPTED);

    let fenceRes: Awaited<ReturnType<typeof postFence>>;
    try {
      fenceRes = await postFence(key, intent);
    } finally {
      releaseHeldTxE();
    }

    const rowAfterFence = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow(
      { where: { key } },
    );
    expect(rowAfterFence.state).toBe(InventoryPriceOperationState.ACCEPTED);
    expect(fenceRes.status).toBe(409);
    expect(fenceRes.body.code).toBe('OPERATION_UNRESOLVED');

    await patchPromise;
    const journal = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow(
      { where: { key } },
    );
    expect(journal.state).toBe(InventoryPriceOperationState.APPLIED);
  });

  it('post-lease fence serializes with in-flight Tx-E catalog write', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('a2a2');
    const targetRetail = 19;
    const intent = fenceBody(item.id, targetRetail, revision);

    guardedPriceTestHooks.failTxEAfterJournalLock = true;
    await guardedPatch(item.id, key, {
      retail_price: targetRetail,
      expectedRevision: revision,
    }).expect(500);
    guardedPriceTestHooks.failTxEAfterJournalLock = false;

    const acceptedAt = new Date(Date.now() - 3 * 60 * 1000);
    await tenantPrisma().inventoryPriceOperation.update({
      where: {
        tenant_id_principal_id_key: {
          tenant_id: tenantId,
          principal_id: testTenant.firebaseUid,
          key,
        },
      },
      data: { accepted_at: acceptedAt },
    });

    guardedPriceTestHooks.holdTxEOpenAfterCatalogUpdate = true;
    const catalogHeld = new Promise<void>((resolve) => {
      guardedPriceTestHooks.onTxECatalogUpdated = () => resolve();
    });

    const patchPromise = guardedPatch(item.id, key, {
      retail_price: targetRetail,
      expectedRevision: revision,
    }).then((res) => res);

    await catalogHeld;
    const midJournal = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow(
      { where: { key } },
    );
    expect(midJournal.state).toBe(InventoryPriceOperationState.ACCEPTED);

    let fenceRes: Awaited<ReturnType<typeof postFence>>;
    try {
      fenceRes = await postFence(key, intent);
    } finally {
      releaseHeldTxECatalog();
    }

    expect(fenceRes.status).toBe(409);
    expect(fenceRes.body.code).toBe('OPERATION_UNRESOLVED');

    const patchRes = await patchPromise;
    expect(patchRes.status).toBe(200);
    const replay = await postFence(key, intent).expect(200);
    expect(replay.body.state).toBe(InventoryPriceOperationState.APPLIED);
    expect(replay.body.retail_price).toBe(patchRes.body.retail_price);
    const pricedAfter = await tenantPrisma().catalogItem.findFirstOrThrow({
      where: { id: item.id },
    });
    expect(Number(pricedAfter.retail_price)).toBe(targetRetail);
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

    await getOperation(key, otherOwnerBearer).expect(404);
    await postFence(key, intent, otherOwnerBearer).expect(404);

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
    expect(list.body.meta.hasNextPage).toBe(false);
    expect(list.body.meta.nextCursor).toBeNull();

    await getOperation(key).expect(404);
  });

  it('list omits other principal rows', async () => {
    const adminItem = await seedItem();
    const adminKey = operationKey('0c01');
    await guardedPatch(adminItem.id, adminKey, {
      retail_price: 16,
      expectedRevision: revisionFromDb(adminItem.revision),
    }).expect(200);

    const otherItem = await seedItem(11, 'OTHER-PRINCIPAL');
    const otherKey = operationKey('0c02');
    await guardedPricePatchRequest(
      app,
      otherItem.id,
      otherKey,
      {
        retail_price: 17,
        expectedRevision: revisionFromDb(otherItem.revision),
      },
      otherOwnerBearer,
    ).expect(200);

    const list = await listOperations().expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].key).toBe(adminKey);
    expect(list.body.data.map((row: { key: string }) => row.key)).not.toContain(
      otherKey,
    );
  });

  it('owner list and get return applied operation', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('f1f1');
    await guardedPatch(item.id, key, {
      retail_price: 16,
      expectedRevision: revision,
    }).expect(200);

    const list = await listOperations().expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].key).toBe(key);
    expect(list.body.data[0].state).toBe(InventoryPriceOperationState.APPLIED);

    const one = await getOperation(key).expect(200);
    expect(one.body.key).toBe(key);
    expect(one.body.itemId).toBe(item.id);
  });

  it('discovery keyset skips omitted rows and reaches visible operation', async () => {
    const anchor = Date.now();
    const visibleItem = await seedItem(10, 'VISIBLE-SKU');
    const visibleKey = operationKeyAt(anchor - 500_000, '0001');
    const visibleRevision = revisionFromDb(visibleItem.revision);

    const principal = testTenant.firebaseUid;
    for (let i = 0; i < 51; i++) {
      const ghost = await seedItem(10, `OMIT-${i}`);
      await tenantPrisma().inventoryPriceOperation.create({
        data: {
          tenant_id: tenantId,
          principal_id: principal,
          key: operationKeyAt(anchor - i * 1000, String(i).padStart(4, '0')),
          item_id: ghost.id,
          sku: ghost.sku,
          kind: GUARDED_PRICE_KIND,
          expected_revision: BigInt(1),
          target_minor: BigInt(1500),
          basis_minor: BigInt(1000),
          state: InventoryPriceOperationState.APPLIED,
          accepted_at: new Date(anchor - i * 1000),
          final_at: new Date(anchor - i * 1000),
        },
      });
      await tenantPrisma().catalogItem.delete({ where: { id: ghost.id } });
    }

    await guardedPatch(visibleItem.id, visibleKey, {
      retail_price: 11,
      expectedRevision: visibleRevision,
    }).expect(200);

    await tenantPrisma().inventoryPriceOperation.update({
      where: {
        tenant_id_principal_id_key: {
          tenant_id: tenantId,
          principal_id: principal,
          key: visibleKey,
        },
      },
      data: { accepted_at: new Date(anchor - 500_000) },
    });

    const list = await listOperations().expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].key).toBe(visibleKey);
    expect(list.body.meta.hasNextPage).toBe(false);
  });

  it('discovery omits final rows past retention', async () => {
    const item = await seedItem();
    const oldMs = Date.now() - GUARDED_PRICE_RETENTION_MS - 60_000;
    const key = operationKeyAt(oldMs, '00e1');
    const oldFinal = new Date(oldMs);
    await tenantPrisma().inventoryPriceOperation.create({
      data: {
        tenant_id: tenantId,
        principal_id: testTenant.firebaseUid,
        key,
        item_id: item.id,
        sku: item.sku,
        kind: GUARDED_PRICE_KIND,
        expected_revision: BigInt(1),
        target_minor: BigInt(1200),
        basis_minor: BigInt(1000),
        state: InventoryPriceOperationState.APPLIED,
        accepted_at: oldFinal,
        final_at: oldFinal,
      },
    });

    const list = await listOperations().expect(200);
    expect(list.body.data).toEqual([]);
    await getOperation(key).expect(404);
  });

  it('SALES gets 403 on list, get, and fence', async () => {
    const salesBearer = await createMemberBearer(
      prisma,
      app.get(AuthService),
      testTenant,
      'SALES',
    );
    const key = operationKey('4031');
    await listOperations(salesBearer).expect(403);
    await getOperation(key, salesBearer).expect(403);
    const item = await seedItem();
    await postFence(
      key,
      fenceBody(item.id, 10, revisionFromDb(item.revision)),
      salesBearer,
    ).expect(403);
  });

  it('in-lease fence returns 409 without holding Tx-E', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('1e01');
    const intent = fenceBody(item.id, 13, revision);

    guardedPriceTestHooks.failTxEAfterJournalLock = true;
    await guardedPatch(item.id, key, {
      retail_price: 13,
      expectedRevision: revision,
    }).expect(500);
    guardedPriceTestHooks.failTxEAfterJournalLock = false;

    const fenceRes = await postFence(key, intent).expect(409);
    expect(fenceRes.body.code).toBe('OPERATION_UNRESOLVED');
    const journal = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow({
      where: { key },
    });
    expect(journal.state).toBe(InventoryPriceOperationState.ACCEPTED);
  });

  it('post-lease fence sets FENCED', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('0e01');

    guardedPriceTestHooks.failTxEAfterJournalLock = true;
    await guardedPatch(item.id, key, {
      retail_price: 13,
      expectedRevision: revision,
    }).expect(500);
    guardedPriceTestHooks.failTxEAfterJournalLock = false;

    const acceptedAt = new Date(Date.now() - 3 * 60 * 1000);
    await tenantPrisma().inventoryPriceOperation.update({
      where: {
        tenant_id_principal_id_key: {
          tenant_id: tenantId,
          principal_id: testTenant.firebaseUid,
          key,
        },
      },
      data: { accepted_at: acceptedAt },
    });

    const fenceRes = await postFence(key, fenceBody(item.id, 13, revision)).expect(
      200,
    );
    expect(fenceRes.body.state).toBe(InventoryPriceOperationState.FENCED);
  });

  it('fence with mismatched intent returns 422', async () => {
    const item = await seedItem();
    const revision = revisionFromDb(item.revision);
    const key = operationKey('0a01');
    await guardedPatch(item.id, key, {
      retail_price: 14,
      expectedRevision: revision,
    }).expect(200);

    const res = await postFence(key, fenceBody(item.id, 99, revision)).expect(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const journal = await tenantPrisma().inventoryPriceOperation.findFirstOrThrow({
      where: { key },
    });
    expect(journal.state).toBe(InventoryPriceOperationState.APPLIED);
  });


  it('discovery keyset returns fifty operations per page', async () => {
    const anchor = Date.now();
    const keys: string[] = [];
    for (let i = 0; i < 51; i++) {
      const item = await seedItem(10, `PAGE-${i}`);
      const key = operationKeyAt(anchor - i * 1000, String(i).padStart(4, '0'));
      keys.push(key);
      await guardedPatch(item.id, key, {
        retail_price: 10 + i,
        expectedRevision: revisionFromDb(item.revision),
      }).expect(200);
    }

    const page1 = await listOperations().expect(200);
    expect(page1.body.data).toHaveLength(50);
    expect(page1.body.meta.hasNextPage).toBe(true);
    expect(page1.body.meta.nextCursor).toBeTruthy();
    const page1Keys = new Set(page1.body.data.map((row: { key: string }) => row.key));

    const page2 = await listOperations(
      undefined,
      page1.body.meta.nextCursor,
    ).expect(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.meta.hasNextPage).toBe(false);
    expect(page1Keys.has(page2.body.data[0].key)).toBe(false);
    expect(keys).toContain(page2.body.data[0].key);
  });

  it('discovery reports no next page when exactly fifty rows exist', async () => {
    const anchor = Date.now();
    for (let i = 0; i < 50; i++) {
      const item = await seedItem(10, `FULL-${i}`);
      const key = operationKeyAt(anchor - i * 1000, String(i).padStart(4, '0'));
      await guardedPatch(item.id, key, {
        retail_price: 10 + i,
        expectedRevision: revisionFromDb(item.revision),
      }).expect(200);
    }

    const list = await listOperations().expect(200);
    expect(list.body.data).toHaveLength(50);
    expect(list.body.meta.hasNextPage).toBe(false);
    expect(list.body.meta.nextCursor).toBeNull();
  });

  it('discovery keyset returns every visible row across batch overflow pages', async () => {
    const anchor = Date.now();
    const principal = testTenant.firebaseUid;
    const visibleKeys: string[] = [];

    for (let i = 0; i < 48; i++) {
      const ghost = await seedItem(10, `OF-${i}`);
      await tenantPrisma().inventoryPriceOperation.create({
        data: {
          tenant_id: tenantId,
          principal_id: principal,
          key: operationKeyAt(anchor - i * 1000, String(i).padStart(4, '0')),
          item_id: ghost.id,
          sku: ghost.sku,
          kind: GUARDED_PRICE_KIND,
          expected_revision: BigInt(1),
          target_minor: BigInt(1500),
          basis_minor: BigInt(1000),
          state: InventoryPriceOperationState.APPLIED,
          accepted_at: new Date(anchor - i * 1000),
          final_at: new Date(anchor - i * 1000),
        },
      });
      await tenantPrisma().catalogItem.delete({ where: { id: ghost.id } });
    }

    for (let i = 48; i < 114; i++) {
      const item = await seedItem(10, `VIS-${i}`);
      const key = operationKeyAt(anchor - i * 1000, String(i).padStart(4, '0'));
      visibleKeys.push(key);
      await guardedPatch(item.id, key, {
        retail_price: 10 + (i % 5),
        expectedRevision: revisionFromDb(item.revision),
      }).expect(200);
    }

    const page1 = await listOperations().expect(200);
    expect(page1.body.data).toHaveLength(50);
    expect(page1.body.meta.hasNextPage).toBe(true);

    const page2 = await listOperations(
      undefined,
      page1.body.meta.nextCursor,
    ).expect(200);
    expect(page2.body.data).toHaveLength(16);
    expect(page2.body.meta.hasNextPage).toBe(false);

    const listedKeys = [
      ...page1.body.data.map((row: { key: string }) => row.key),
      ...page2.body.data.map((row: { key: string }) => row.key),
    ].sort();
    expect(listedKeys).toEqual([...visibleKeys].sort());
  });

  it('rejects invalid discovery cursor with 400', async () => {
    const badGarbled = await listOperations(undefined, '%%%not-a-cursor%%%');
    expect(badGarbled.status).toBe(400);
    expect(badGarbled.body.code).toBe('GUARDED_REQUEST_INVALID');
    const nonV7Cursor = encodePriceOperationDiscoveryCursor({
      acceptedAt: new Date().toISOString(),
      key: '00000000-0000-4000-8000-000000000000',
    });
    const badUuid = await listOperations(undefined, nonV7Cursor);
    expect(badUuid.status).toBe(400);
    expect(badUuid.body.code).toBe('GUARDED_REQUEST_INVALID');
  });

  it.each([
    {
      terminalState: InventoryPriceOperationState.APPLIED,
      keySuffix: '0d01',
      retail: 15,
    },
    {
      terminalState: InventoryPriceOperationState.CONFLICT,
      keySuffix: '0d02',
      retail: 11,
    },
    {
      terminalState: InventoryPriceOperationState.FENCED,
      keySuffix: '0d03',
      retail: 12,
    },
  ])(
    'fence on terminal $terminalState row is idempotent',
    async ({ terminalState, keySuffix, retail }) => {
      const item = await seedItem();
      const revision = revisionFromDb(item.revision);
      const key = operationKey(keySuffix);
      const intent = fenceBody(item.id, retail, revision);

      let appliedRetail: string | undefined;
      if (terminalState === InventoryPriceOperationState.FENCED) {
        await postFence(key, intent).expect(200);
      } else {
        const applied = await guardedPatch(item.id, key, {
          retail_price: retail,
          expectedRevision: revision,
        }).expect(200);
        appliedRetail = applied.body.retail_price;
        if (terminalState === InventoryPriceOperationState.CONFLICT) {
          await tenantPrisma().inventoryPriceOperation.update({
            where: {
              tenant_id_principal_id_key: {
                tenant_id: tenantId,
                principal_id: testTenant.firebaseUid,
                key,
              },
            },
            data: {
              state: InventoryPriceOperationState.CONFLICT,
              error_code: 'REVISION_CONFLICT',
              final_at: new Date(),
            },
          });
        }
      }

      const replay = await postFence(key, intent).expect(200);
      expect(replay.body.state).toBe(terminalState);
      if (terminalState === InventoryPriceOperationState.APPLIED) {
        expect(replay.body.retail_price).toBe(appliedRetail);
      }
    },
  );
});
