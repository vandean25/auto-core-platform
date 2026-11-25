import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  LocationType,
  StockAdjustmentReason,
  TenantMemberRole,
  TransactionType,
} from '@prisma/client';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PermissionResolver, legacyAccessOfRole } from '../src/permissions/permission-resolver.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  createTenantAwarePrisma,
  resolveTestMainSiteId,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Inventory item mutations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let authTokenAdmin: string;
  let testTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let catalogItemId: string;
  let binLocationId: string;
  let siteId: string;
  let adminUserId: string;

  beforeEach(async () => {
    app = await createE2eApp();

    prisma = app.get(PrismaService);
    testTenant = await createTestTenant(prisma, 'inventory-mutations');
    tenantId = testTenant.tenantId;
    authTokenAdmin = createTestAuthToken(app.get(AuthService), testTenant);
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: testTenant.firebaseUid },
      select: { id: true },
    });
    adminUserId = adminUser.id;

    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    siteId = await resolveTestMainSiteId(prisma, tenantId);
    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: 'DEMO-PART-001',
        name: 'Demo filter',
        cost_price: 4.5,
        retail_price: 9.99,
        unit: 'pcs',
      },
    });
    catalogItemId = catalogItem.id;

    const warehouse = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        code: 'WH-DEMO-01',
        name: 'Demo warehouse',
        type: LocationType.warehouse,
        site_id: siteId,
      },
    });
    const bin = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        code: 'BIN-DEMO-01',
        name: 'Demo bin A1',
        type: LocationType.bin,
        site_id: siteId,
        parent_id: warehouse.id,
      },
    });
    binLocationId = bin.id;
  });

  afterEach(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  it('receives stock and exposes the ledger entry', async () => {
    await request(app.getHttpServer())
      .post(`/api/inventory/${catalogItemId}/receive`)
      .set('Authorization', `Bearer ${authTokenAdmin}`)
      .send({ locationId: binLocationId, quantity: 3 })
      .expect(204);

    const history = await request(app.getHttpServer())
      .get(`/api/inventory/${catalogItemId}/history`)
      .set('Authorization', `Bearer ${authTokenAdmin}`)
      .expect(200);

    expect(history.body[0]).toMatchObject({
      type: 'PURCHASE_RECEIPT',
      quantity: '3',
      reference_id: 'manual-receipt',
    });
  });

  it('rejects adjustments that would drive stock negative', async () => {
    await request(app.getHttpServer())
      .post(`/api/inventory/${catalogItemId}/adjust`)
      .set('Authorization', `Bearer ${authTokenAdmin}`)
      .send({
        locationId: binLocationId,
        quantity: -5,
        reason: StockAdjustmentReason.INVENTORY_COUNT,
      })
      .expect(400);
  });

  // AUT-886: the bulk price change on the parts list sends one PATCH per selected part and relies on this per-record 403.
  it.each<{ role: TenantMemberRole; status: number }>([
    { role: 'TECH', status: 403 },
    { role: 'SALES', status: 403 },
    { role: 'ADMIN', status: 200 },
    { role: 'OWNER', status: 200 },
  ])('answers PATCH /inventory/:id with $status for role $role', async ({ role, status }) => {
    await runWithTenantContext(tenantId, async () => {
      await prisma.tenantMember.updateMany({ where: { tenant_id: tenantId }, data: { role } });
    });
    const token = createTestAuthToken(app.get(AuthService), { ...testTenant, role }, { role });

    const response = await request(app.getHttpServer())
      .patch(`/api/inventory/${catalogItemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: 'DEMO-PART-001', name: 'Demo filter', cost_price: 4.5, retail_price: 10.99 })
      .expect(status);

    if (status === 200) expect(Number(response.body.retail_price)).toBe(10.99);
    const stored = await createTenantAwarePrisma(prisma, tenantId).catalogItem.findFirst({ where: { id: catalogItemId } });
    expect(Number(stored?.retail_price)).toBe(status === 200 ? 10.99 : 9.99);
  });

  it('forbids TECH users from receiving stock', async () => {
    await runWithTenantContext(tenantId, async () => {
      await prisma.tenantMember.updateMany({
        where: { tenant_id: tenantId },
        data: { role: 'TECH' },
      });
    });

    const authTokenTech = createTestAuthToken(
      app.get(AuthService),
      { ...testTenant, role: 'TECH' },
      { role: 'TECH' },
    );

    await request(app.getHttpServer())
      .post(`/api/inventory/${catalogItemId}/receive`)
      .set('Authorization', `Bearer ${authTokenTech}`)
      .send({ locationId: binLocationId, quantity: 1 })
      .expect(403);
  });

  describe('AUT-1048 valued stock corrections, immutability and Gegenbuchung', () => {
    it('Scenario 1: auto-values +n and -n adjustments from current InventoryValuation average with 4-decimal unit cost and 2-decimal extended value', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      const site = await tenantPrisma.site.findFirstOrThrow({
        where: { id: siteId, tenant_id: tenantId },
      });
      await tenantPrisma.inventoryValuation.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: site.legal_entity_id,
          catalog_item_id: catalogItemId,
          average_unit_cost: 12.3456,
          valued_quantity: 5,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 3,
          reason: StockAdjustmentReason.FOUND,
        })
        .expect(204);

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: -2,
          reason: StockAdjustmentReason.BREAKAGE,
        })
        .expect(204);

      const history = await request(app.getHttpServer())
        .get(`/api/inventory/${catalogItemId}/history`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(200);

      const minusRow = history.body.find(
        (tx: { quantity: string }) => tx.quantity === '-2',
      );
      const plusRow = history.body.find(
        (tx: { quantity: string }) => tx.quantity === '3',
      );

      expect(plusRow).toMatchObject({
        type: 'ADJUSTMENT',
        cost_basis: '12.3456',
        extended_value: '37.04',
        value_source: 'AVG',
        reason: 'FOUND',
        created_by_user_id: adminUserId,
      });
      expect(minusRow).toMatchObject({
        type: 'ADJUSTMENT',
        cost_basis: '12.3456',
        extended_value: '-24.69',
        value_source: 'AVG',
        reason: 'BREAKAGE',
        created_by_user_id: adminUserId,
      });
    });

    it('Scenario 2: falls back to same-legal-entity PURCHASE_RECEIPT.cost_basis with value_source LAST_EK when no average exists', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      const vendor = await tenantPrisma.vendor.create({
        data: { tenant_id: tenantId, name: 'V1', email: 'v1@example.invalid', account_number: 'V1-ACC' },
      });
      await tenantPrisma.vendorArticle.create({
        data: {
          tenant_id: tenantId,
          vendor_id: vendor.id,
          catalog_item_id: catalogItemId,
          vendor_article_no: 'VA-1',
          last_cost: 9.99,
        },
      });
      await tenantPrisma.inventoryTransaction.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          item_id: catalogItemId,
          location_id: binLocationId,
          quantity: 1,
          type: TransactionType.PURCHASE_RECEIPT,
          cost_basis: 7.25,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 2,
          reason: StockAdjustmentReason.INVENTORY_COUNT,
        })
        .expect(204);

      const history = await request(app.getHttpServer())
        .get(`/api/inventory/${catalogItemId}/history`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(200);

      expect(history.body[0]).toMatchObject({
        type: 'ADJUSTMENT',
        cost_basis: '7.25',
        value_source: 'LAST_EK',
      });
    });

    it('Scenario 3: falls back to CatalogItem.cost_price with value_source LAST_EK when no average and no same-LE receipt exist', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      const vendor = await tenantPrisma.vendor.create({
        data: { tenant_id: tenantId, name: 'V2', email: 'v2@example.invalid', account_number: 'V2-ACC' },
      });
      await tenantPrisma.vendorArticle.create({
        data: {
          tenant_id: tenantId,
          vendor_id: vendor.id,
          catalog_item_id: catalogItemId,
          vendor_article_no: 'VA-2',
          last_cost: 9.99,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 1,
          reason: StockAdjustmentReason.FOUND,
        })
        .expect(204);

      const history = await request(app.getHttpServer())
        .get(`/api/inventory/${catalogItemId}/history`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(200);

      expect(history.body[0]).toMatchObject({
        type: 'ADJUSTMENT',
        cost_basis: '4.5',
        value_source: 'LAST_EK',
      });
    });

    it('Scenario 4: falls back to newest VendorArticle.last_cost with value_source LAST_EK when no average, receipt, or cost_price exist', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      await tenantPrisma.catalogItem.update({
        where: { id: catalogItemId, tenant_id: tenantId },
        data: { cost_price: null },
      });
      const vendor = await tenantPrisma.vendor.create({
        data: { tenant_id: tenantId, name: 'V3', email: 'v3@example.invalid', account_number: 'V3-ACC' },
      });
      await tenantPrisma.vendorArticle.create({
        data: {
          tenant_id: tenantId,
          vendor_id: vendor.id,
          catalog_item_id: catalogItemId,
          vendor_article_no: 'VA-3',
          last_cost: 6.75,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 1,
          reason: StockAdjustmentReason.FOUND,
        })
        .expect(204);

      const history = await request(app.getHttpServer())
        .get(`/api/inventory/${catalogItemId}/history`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(200);

      expect(history.body[0]).toMatchObject({
        type: 'ADJUSTMENT',
        cost_basis: '6.75',
        value_source: 'LAST_EK',
      });
    });

    it('Scenario 5 & Anti-criterion 1: returns 400 when no fallback exists and value is omitted, and rejects free-text reason', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      await tenantPrisma.catalogItem.update({
        where: { id: catalogItemId, tenant_id: tenantId },
        data: { cost_price: null },
      });

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 1,
          reason: StockAdjustmentReason.INVENTORY_COUNT,
        })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 1,
          reason: 'Free text reason',
        })
        .expect(400);

      const count = await tenantPrisma.inventoryTransaction.count({
        where: { tenant_id: tenantId, item_id: catalogItemId },
      });
      expect(count).toBe(0);
    });

    it('Scenario 6: stores MANUAL value_source when no fallback exists and user supplies unitCost + overrideReason with permission', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      await tenantPrisma.catalogItem.update({
        where: { id: catalogItemId, tenant_id: tenantId },
        data: { cost_price: null },
      });

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 2,
          reason: StockAdjustmentReason.FOUND,
          unitCost: 11.25,
          overrideReason: 'Initial inventory valuation',
        })
        .expect(204);

      const history = await request(app.getHttpServer())
        .get(`/api/inventory/${catalogItemId}/history`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(200);

      expect(history.body[0]).toMatchObject({
        type: 'ADJUSTMENT',
        cost_basis: '11.25',
        extended_value: '22.5',
        value_source: 'MANUAL',
        override_reason: 'Initial inventory valuation',
      });
    });

    it('Scenario 7 & Anti-criterion 3: role with stock.adjust but without stock.adjust.override_value gets 403 on manual override, 204 on automatic adjustment', async () => {
      const resolver = app.get(PermissionResolver);
      const spy = jest.spyOn(resolver, 'resolve').mockResolvedValue({
        role: 'ADMIN',
        permissions: new Set(['stock.adjust']),
      });

      try {
        await request(app.getHttpServer())
          .post(`/api/inventory/${catalogItemId}/adjust`)
          .set('Authorization', `Bearer ${authTokenAdmin}`)
          .send({
            locationId: binLocationId,
            quantity: 1,
            reason: StockAdjustmentReason.INVENTORY_COUNT,
            unitCost: 99.0,
            overrideReason: 'Unauthorized override',
          })
          .expect(403);

        await request(app.getHttpServer())
          .post(`/api/inventory/${catalogItemId}/adjust`)
          .set('Authorization', `Bearer ${authTokenAdmin}`)
          .send({
            locationId: binLocationId,
            quantity: 1,
            reason: StockAdjustmentReason.INVENTORY_COUNT,
          })
          .expect(204);
      } finally {
        spy.mockRestore();
      }
    });

    it('Scenario 8: returns 400 when overriding automatic value without overrideReason', async () => {
      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 1,
          reason: StockAdjustmentReason.INVENTORY_COUNT,
          unitCost: 9.99,
        })
        .expect(400);

      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      const count = await tenantPrisma.inventoryTransaction.count({
        where: { tenant_id: tenantId, item_id: catalogItemId },
      });
      expect(count).toBe(0);
    });

    it('Scenario 9: requires note when reason is OTHER, optional for other reasons', async () => {
      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 1,
          reason: StockAdjustmentReason.OTHER,
          note: '   ',
        })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 1,
          reason: StockAdjustmentReason.SHRINKAGE,
        })
        .expect(204);
    });

    it('Scenario 10, 11 & Anti-criterion 4: reverses an adjustment once via Gegenbuchung, restoring stock and valuation without mutating original', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      const site = await tenantPrisma.site.findFirstOrThrow({
        where: { id: siteId, tenant_id: tenantId },
      });
      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/receive`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({ locationId: binLocationId, quantity: 4 })
        .expect(204);

      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 2,
          reason: StockAdjustmentReason.FOUND,
          note: 'Found on shelf B',
        })
        .expect(204);

      const historyBefore = await request(app.getHttpServer())
        .get(`/api/inventory/${catalogItemId}/history`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(200);
      const originalTx = historyBefore.body.find(
        (tx: { type: string }) => tx.type === 'ADJUSTMENT',
      );

      const reverseRes = await request(app.getHttpServer())
        .post(`/api/inventory/transactions/${originalTx.id}/reverse`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(201);

      expect(reverseRes.body).toMatchObject({
        type: 'ADJUSTMENT',
        quantity: '-2',
        cost_basis: originalTx.cost_basis,
        extended_value: '-9',
        reversal_of_transaction_id: originalTx.id,
        created_by_user_id: adminUserId,
      });

      // Scenario 11: second reversal rejected with 409
      await request(app.getHttpServer())
        .post(`/api/inventory/transactions/${originalTx.id}/reverse`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(409);

      // Stock and valuation returned to pre-correction state (4 units @ 4.5)
      const stock = await tenantPrisma.inventoryStock.findFirstOrThrow({
        where: {
          tenant_id: tenantId,
          catalog_item_id: catalogItemId,
          location_id: binLocationId,
        },
      });
      expect(Number(stock.quantity_on_hand)).toBe(4);

      const valuation = await tenantPrisma.inventoryValuation.findFirstOrThrow({
        where: {
          tenant_id: tenantId,
          legal_entity_id: site.legal_entity_id,
          catalog_item_id: catalogItemId,
        },
      });
      expect(Number(valuation.valued_quantity)).toBe(4);
      expect(Number(valuation.average_unit_cost)).toBe(4.5);

      // Anti-criterion 4: original row unchanged
      const originalAfter = await tenantPrisma.inventoryTransaction.findFirstOrThrow({
        where: { id: originalTx.id, tenant_id: tenantId },
      });
      expect(Number(originalAfter.quantity)).toBe(2);
      expect(Number(originalAfter.cost_basis)).toBe(4.5);
      expect(originalAfter.reason).toBe('FOUND');
      expect(originalAfter.note).toBe('Found on shelf B');
      expect(originalAfter.value_source).toBe('AVG');
      expect(originalAfter.created_by_user_id).toBe(adminUserId);

      // Reversing an override whose unit cost differs from the prior average
      // also restores both average_unit_cost and valued_quantity (4 @ 4.5 -> +2 @ 10.5 -> 6 @ 6.5 -> reverse -> 4 @ 4.5).
      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 2,
          reason: StockAdjustmentReason.INVENTORY_COUNT,
          unitCost: 10.5,
          overrideReason: 'Special batch cost',
        })
        .expect(204);

      const valuationAfterOverride =
        await tenantPrisma.inventoryValuation.findFirstOrThrow({
          where: {
            tenant_id: tenantId,
            legal_entity_id: site.legal_entity_id,
            catalog_item_id: catalogItemId,
          },
        });
      expect(Number(valuationAfterOverride.valued_quantity)).toBe(6);
      expect(Number(valuationAfterOverride.average_unit_cost)).toBe(6.5);

      const historyWithOverride = await request(app.getHttpServer())
        .get(`/api/inventory/${catalogItemId}/history`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(200);
      const overrideTx = historyWithOverride.body.find(
        (tx: { type: string; value_source: string | null }) =>
          tx.type === 'ADJUSTMENT' && tx.value_source === 'MANUAL',
      );

      await request(app.getHttpServer())
        .post(`/api/inventory/transactions/${overrideTx.id}/reverse`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(201);

      const valuationAfterOverrideReversal =
        await tenantPrisma.inventoryValuation.findFirstOrThrow({
          where: {
            tenant_id: tenantId,
            legal_entity_id: site.legal_entity_id,
            catalog_item_id: catalogItemId,
          },
        });
      expect(Number(valuationAfterOverrideReversal.valued_quantity)).toBe(4);
      expect(Number(valuationAfterOverrideReversal.average_unit_cost)).toBe(4.5);
    });

    it('Scenario 13 & Anti-criteria 2, 5: DB trigger rejects direct UPDATE/DELETE while clean-db purge flag allows cleanup', async () => {
      await request(app.getHttpServer())
        .post(`/api/inventory/${catalogItemId}/adjust`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({
          locationId: binLocationId,
          quantity: 1,
          reason: StockAdjustmentReason.FOUND,
        })
        .expect(204);

      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      const txRow = await tenantPrisma.inventoryTransaction.findFirstOrThrow({
        where: { tenant_id: tenantId, item_id: catalogItemId },
      });

      // No PATCH/DELETE routes exist
      await request(app.getHttpServer())
        .patch(`/api/inventory/transactions/${txRow.id}`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .send({ quantity: 99 })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/inventory/transactions/${txRow.id}`)
        .set('Authorization', `Bearer ${authTokenAdmin}`)
        .expect(404);

      // Direct UPDATE/DELETE without acp.allow_purge rejected by trigger
      await expect(
        tenantPrisma.inventoryTransaction.update({
          where: { id: txRow.id },
          data: { quantity: 99 },
        }),
      ).rejects.toThrow(/immutable/i);

      await expect(
        tenantPrisma.inventoryTransaction.delete({
          where: { id: txRow.id },
        }),
      ).rejects.toThrow(/immutable/i);
    });
  });
});
