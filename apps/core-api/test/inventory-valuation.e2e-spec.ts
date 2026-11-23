import { INestApplication } from '@nestjs/common';
import {
  LocationType,
  Prisma,
  TransactionType,
} from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { TenantContextStorage } from '../src/common/services/tenant-context.storage.js';
import { AtpService } from '../src/inventory/atp.service.js';
import { InventoryValuationService } from '../src/inventory/inventory-valuation.service.js';
import { LedgerService } from '../src/inventory/ledger.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { processSaleInventoryDeduction } from '../src/sales/helpers/invoice-inventory.helpers.js';
import { WorkshopKpiReportsService } from '../src/workshop/workshop-kpi-reports.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

import Decimal = Prisma.Decimal;

describe('Inventory Valuation (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  let firebaseUid: string;
  let dbUserId: string;
  let defaultLegalEntityId: string;
  let defaultSiteId: string;
  let binAId: string;
  let vendorId: string;

  let ledgerService: LedgerService;
  let valuationService: InventoryValuationService;
  let atpService: AtpService;
  let kpiReportsService: WorkshopKpiReportsService;

  beforeAll(async () => {
    app = await createE2eApp();
    basePrisma = app.get<PrismaService>(PrismaService);
    ledgerService = app.get<LedgerService>(LedgerService);
    valuationService = app.get<InventoryValuationService>(
      InventoryValuationService,
    );
    atpService = app.get<AtpService>(AtpService);
    kpiReportsService = app.get<WorkshopKpiReportsService>(
      WorkshopKpiReportsService,
    );

    const testTenant = await createTestTenant(basePrisma);
    tenantId = testTenant.tenantId;
    firebaseUid = testTenant.firebaseUid;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    const [site, user] = await Promise.all([
      prisma.site.findFirstOrThrow({
        where: { tenant_id: tenantId },
        select: { id: true, legal_entity_id: true },
      }),
      basePrisma.user.findFirstOrThrow({
        where: { firebaseUid: testTenant.firebaseUid },
        select: { id: true },
      }),
    ]);
    defaultSiteId = site.id;
    defaultLegalEntityId = site.legal_entity_id;
    dbUserId = user.id;

    const binA = await prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: defaultSiteId,
        code: 'BIN-VAL-A',
        name: 'Valuation Bin A',
        type: LocationType.bin,
      },
    });
    binAId = binA.id;

    const vendor = await prisma.vendor.create({
      data: {
        tenant_id: tenantId,
        name: 'Valuation Vendor',
        email: 'valuation-vendor@example.com',
        account_number: 'VAL-V-001',
      },
    });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.vendorArticle.deleteMany({});
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  async function runInTenantContext<T>(
    fn: () => Promise<T>,
    siteId: string = defaultSiteId,
  ): Promise<T> {
    return TenantContextStorage.run(() => {
      TenantContextStorage.setUser({
        tenantId,
        userId: firebaseUid,
        email: 'e2e-valuation@example.com',
        role: 'ADMIN',
        activeSiteId: siteId,
      });
      return fn();
    });
  }

  async function createItem(sku: string, costPrice: number | null = null) {
    return prisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku,
        name: `Part ${sku}`,
        cost_price: costPrice !== null ? new Decimal(costPrice) : null,
        retail_price: new Decimal(100),
      },
    });
  }

  it('Scenario 1 & Anti-criterion 3: PO receipt updates InventoryValuation atomically and rolls back on failure', async () => {
    const item = await createItem('SKU-SCEN-1', 10);

    const poRes = await request(app.getHttpServer())
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vendorId,
        items: [{ catalogItemId: item.id, quantity: 4, unitCost: 12.5 }],
      })
      .expect(201);

    const poItemId = poRes.body.items[0].id as string;

    await request(app.getHttpServer())
      .post(`/api/purchase-orders/${poRes.body.id}/receive`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [{ itemId: poItemId, quantity: 4, locationId: binAId }],
      })
      .expect(201);

    const valuation = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: item.id,
      },
    });
    expect(valuation).not.toBeNull();
    expect(new Decimal(valuation!.average_unit_cost!).toFixed(4)).toBe(
      '12.5000',
    );
    expect(new Decimal(valuation!.valued_quantity).toFixed(3)).toBe('4.000');
    expect(valuation!.last_booking_seq).not.toBeNull();

    // Anti-criterion 3: injected failure after valuation lock + ledger insert rolls back both
    await expect(
      runInTenantContext(() =>
        basePrisma.$transaction(async (tx) => {
          await ledgerService.recordTransactions(
            [
              {
                itemId: item.id,
                locationId: binAId,
                quantity: 6,
                type: TransactionType.PURCHASE_RECEIPT,
                costBasis: 20,
              },
            ],
            tx,
          );
          throw new Error('Injected failure after ledger + valuation write');
        }),
      ),
    ).rejects.toThrow('Injected failure after ledger + valuation write');

    const valuationAfterRollback = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: item.id,
      },
    });
    expect(
      new Decimal(valuationAfterRollback!.average_unit_cost!).toFixed(4),
    ).toBe('12.5000');
    expect(
      new Decimal(valuationAfterRollback!.valued_quantity).toFixed(3),
    ).toBe('4.000');
  });

  it('Scenario 2: outbound sale issue and workshop consumption reduce valued_quantity and stamp current average', async () => {
    const item = await createItem('SKU-SCEN-2', 10);

    await runInTenantContext(async () => {
      await ledgerService.recordTransactions([
        {
          itemId: item.id,
          locationId: binAId,
          quantity: 10,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 10,
        },
        {
          itemId: item.id,
          locationId: binAId,
          quantity: 10,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 15,
        },
      ]);

      // Workshop consumption via LedgerService
      await ledgerService.recordTransactions([
        {
          itemId: item.id,
          locationId: binAId,
          quantity: -4,
          type: TransactionType.WORKSHOP_CONSUMPTION,
          referenceId: 'WO-SCEN-2',
          costBasis: null,
        },
      ]);

      // Sale issue via processSaleInventoryDeduction
      await basePrisma.$transaction((tx) =>
        processSaleInventoryDeduction({
          tx,
          tenantId,
          siteId: defaultSiteId,
          invoiceItems: [
            {
              id: 'inv-item-1',
              tenant_id: tenantId,
              invoice_id: 'inv-1',
              catalog_item_id: item.id,
              description: item.name,
              quantity: new Decimal(3),
              unit_price: new Decimal(100),
              tax_rate: new Decimal(20),
              line_discount_type: null,
              line_discount_value: null,
              line_total: new Decimal(300),
              revenue_group_name: null,
              accounting_snapshot: null,
              workshop_task_line_item_id: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          invoiceNumber: 'RE-SCEN-2',
          atpService,
          inventoryValuationService: valuationService,
        }),
      );
    });

    const valuation = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: item.id,
      },
    });
    expect(new Decimal(valuation!.average_unit_cost!).toFixed(4)).toBe(
      '12.5000',
    );
    expect(new Decimal(valuation!.valued_quantity).toFixed(3)).toBe('13.000');

    const outbounds = await prisma.inventoryTransaction.findMany({
      where: {
        tenant_id: tenantId,
        item_id: item.id,
        type: {
          in: [
            TransactionType.WORKSHOP_CONSUMPTION,
            TransactionType.SALE_ISSUE,
          ],
        },
      },
      orderBy: { seq: 'asc' },
    });
    expect(outbounds).toHaveLength(2);
    expect(new Decimal(outbounds[0].cost_basis!).toFixed(4)).toBe('12.5000');
    expect(new Decimal(outbounds[1].cost_basis!).toFixed(4)).toBe('12.5000');
  });

  it('Scenario 3: concurrent receipts for the same article and legal entity do not lose updates', async () => {
    const item = await createItem('SKU-SCEN-3');
    await prisma.inventoryStock.create({
      data: {
        tenant_id: tenantId,
        site_id: defaultSiteId,
        catalog_item_id: item.id,
        location_id: binAId,
        quantity_on_hand: new Decimal(0),
        quantity_reserved: new Decimal(0),
      },
    });

    await Promise.all([
      runInTenantContext(() =>
        basePrisma.$transaction((tx) =>
          ledgerService.recordTransactions(
            [
              {
                itemId: item.id,
                locationId: binAId,
                quantity: 5,
                type: TransactionType.PURCHASE_RECEIPT,
                costBasis: 10,
              },
            ],
            tx,
          ),
        ),
      ),
      runInTenantContext(() =>
        basePrisma.$transaction((tx) =>
          ledgerService.recordTransactions(
            [
              {
                itemId: item.id,
                locationId: binAId,
                quantity: 5,
                type: TransactionType.PURCHASE_RECEIPT,
                costBasis: 20,
              },
            ],
            tx,
          ),
        ),
      ),
    ]);

    const txs = await prisma.inventoryTransaction.findMany({
      where: { tenant_id: tenantId, item_id: item.id },
    });
    const valuation = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: item.id,
      },
    });
    expect(txs).toHaveLength(2);
    expect(new Decimal(valuation!.valued_quantity).toFixed(3)).toBe('10.000');
    expect(new Decimal(valuation!.average_unit_cost!).toFixed(4)).toBe(
      '15.0000',
    );
  });

  it('Scenario 4: zero-qty freezes last average and restarts on next valued receipt', async () => {
    const item = await createItem('SKU-SCEN-4');

    await runInTenantContext(async () => {
      await ledgerService.recordTransactions([
        {
          itemId: item.id,
          locationId: binAId,
          quantity: 4,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 10,
        },
      ]);
      await ledgerService.recordTransactions([
        {
          itemId: item.id,
          locationId: binAId,
          quantity: -4,
          type: TransactionType.SALE_ISSUE,
        },
      ]);
    });

    const frozen = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: item.id,
      },
    });
    expect(new Decimal(frozen!.valued_quantity).toFixed(3)).toBe('0.000');
    expect(new Decimal(frozen!.average_unit_cost!).toFixed(4)).toBe('10.0000');

    await runInTenantContext(() =>
      ledgerService.recordTransactions([
        {
          itemId: item.id,
          locationId: binAId,
          quantity: 3,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 24,
        },
      ]),
    );

    const restarted = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: item.id,
      },
    });
    expect(new Decimal(restarted!.valued_quantity).toFixed(3)).toBe('3.000');
    expect(new Decimal(restarted!.average_unit_cost!).toFixed(4)).toBe(
      '24.0000',
    );
  });

  it('Scenario 5 & Anti-criterion 1 & 2: backfill tolerates gaps, reports them, is idempotent, and live bookings never scan journal', async () => {
    const mixedItem = await createItem('SKU-SCEN-5-MIXED', 99);
    const gapOnlyItem = await createItem('SKU-SCEN-5-GAP', 88);

    // Seed raw ledger rows directly (simulating pre-feature history)
    await prisma.inventoryTransaction.createMany({
      data: [
        {
          tenant_id: tenantId,
          site_id: defaultSiteId,
          item_id: mixedItem.id,
          location_id: binAId,
          quantity: new Decimal(10),
          type: TransactionType.PURCHASE_RECEIPT,
          cost_basis: new Decimal(14),
        },
        {
          tenant_id: tenantId,
          site_id: defaultSiteId,
          item_id: mixedItem.id,
          location_id: binAId,
          quantity: new Decimal(5),
          type: TransactionType.ADJUSTMENT,
          cost_basis: null,
        },
        {
          tenant_id: tenantId,
          site_id: defaultSiteId,
          item_id: gapOnlyItem.id,
          location_id: binAId,
          quantity: new Decimal(3),
          type: TransactionType.ADJUSTMENT,
          cost_basis: null,
        },
      ],
    });
    await prisma.inventoryStock.createMany({
      data: [
        {
          tenant_id: tenantId,
          site_id: defaultSiteId,
          catalog_item_id: mixedItem.id,
          location_id: binAId,
          quantity_on_hand: new Decimal(15),
          quantity_reserved: new Decimal(0),
        },
        {
          tenant_id: tenantId,
          site_id: defaultSiteId,
          catalog_item_id: gapOnlyItem.id,
          location_id: binAId,
          quantity_on_hand: new Decimal(3),
          quantity_reserved: new Decimal(0),
        },
      ],
    });

    const report1 = await runInTenantContext(() =>
      valuationService.backfillTenant(tenantId),
    );
    const report2 = await runInTenantContext(() =>
      valuationService.backfillTenant(tenantId),
    );
    expect(report1.gapCount).toBe(report2.gapCount);
    expect(
      report1.gaps.some((g) => g.catalogItemId === mixedItem.id),
    ).toBe(true);
    expect(
      report1.gaps.some((g) => g.catalogItemId === gapOnlyItem.id),
    ).toBe(true);

    const mixedVal = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: mixedItem.id,
      },
    });
    expect(new Decimal(mixedVal!.average_unit_cost!).toFixed(4)).toBe(
      '14.0000',
    );
    expect(new Decimal(mixedVal!.valued_quantity).toFixed(3)).toBe('10.000');

    // Anti-criterion 2: gap-only article has no invented average (cost_price 88 is NOT used)
    const gapVal = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: gapOnlyItem.id,
      },
    });
    expect(gapVal!.average_unit_cost).toBeNull();
    expect(new Decimal(gapVal!.valued_quantity).toFixed(3)).toBe('0.000');

    // Anti-criterion 1: live booking after backfill does not scan historical InventoryTransaction rows
    const findManySpy = jest.spyOn(
      basePrisma.inventoryTransaction,
      'findMany',
    );
    const findFirstSpy = jest.spyOn(
      basePrisma.inventoryTransaction,
      'findFirst',
    );
    await runInTenantContext(() =>
      ledgerService.recordTransactions([
        {
          itemId: mixedItem.id,
          locationId: binAId,
          quantity: 10,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 18,
        },
      ]),
    );
    expect(findManySpy).not.toHaveBeenCalled();
    expect(findFirstSpy).not.toHaveBeenCalled();
    findManySpy.mockRestore();
    findFirstSpy.mockRestore();

    const updatedMixed = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: mixedItem.id,
      },
    });
    expect(new Decimal(updatedMixed!.average_unit_cost!).toFixed(4)).toBe(
      '16.0000',
    );
    expect(new Decimal(updatedMixed!.valued_quantity).toFixed(3)).toBe(
      '20.000',
    );
  });

  it('Scenarios 6, 7, 8 & Anti-criterion 5: per-legal-entity scope across sites, isolation between legal entities, and transfer invariance', async () => {
    const site2SameLe = await prisma.site.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        code: 'SITE-LE1-B',
        name: 'Site 2 Same LE',
      },
    });
    const binSite2 = await prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: site2SameLe.id,
        code: 'BIN-SITE2',
        name: 'Bin Site 2',
        type: LocationType.bin,
      },
    });

    const le2 = await prisma.legalEntity.create({
      data: {
        tenant_id: tenantId,
        name: 'Second Legal Entity GmbH',
        country_iso: 'AT',
      },
    });
    const siteLe2 = await prisma.site.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: le2.id,
        code: 'SITE-LE2',
        name: 'Site LE2',
      },
    });
    const binLe2 = await prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: siteLe2.id,
        code: 'BIN-LE2',
        name: 'Bin LE2',
        type: LocationType.bin,
      },
    });

    const item = await createItem('SKU-SCEN-678');

    await runInTenantContext(async () => {
      // Receive at Site 1 (LE1) and Site 2 (LE1) -> Scenario 6: single valuation row
      await ledgerService.recordTransactions(
        [
          {
            itemId: item.id,
            locationId: binAId,
            quantity: 10,
            type: TransactionType.PURCHASE_RECEIPT,
            costBasis: 10,
          },
          {
            itemId: item.id,
            locationId: binSite2.id,
            quantity: 10,
            type: TransactionType.PURCHASE_RECEIPT,
            costBasis: 20,
          },
        ],
        undefined,
        { authorizedSiteIds: [defaultSiteId, site2SameLe.id] },
      );

      // Scenario 7: Receive at LE2 -> separate valuation row
      await ledgerService.recordTransactions(
        [
          {
            itemId: item.id,
            locationId: binLe2.id,
            quantity: 5,
            type: TransactionType.PURCHASE_RECEIPT,
            costBasis: 50,
          },
        ],
        undefined,
        { authorizedSiteIds: [siteLe2.id] },
      );

      // Scenario 8 & Anti-criterion 5: Same-LE transfer between Site 1 and Site 2 leaves LE1 valuation unchanged
      await ledgerService.recordTransactions(
        [
          {
            itemId: item.id,
            locationId: binAId,
            quantity: -4,
            type: TransactionType.TRANSFER_OUT,
            costBasis: 15,
          },
          {
            itemId: item.id,
            locationId: binSite2.id,
            quantity: 4,
            type: TransactionType.TRANSFER_IN,
            costBasis: 15,
          },
        ],
        undefined,
        { authorizedSiteIds: [defaultSiteId, site2SameLe.id] },
      );
    });

    const valuations = await prisma.inventoryValuation.findMany({
      where: { tenant_id: tenantId, catalog_item_id: item.id },
    });
    expect(valuations).toHaveLength(2);

    const le1Val = valuations.find(
      (v) => v.legal_entity_id === defaultLegalEntityId,
    )!;
    const le2Val = valuations.find((v) => v.legal_entity_id === le2.id)!;

    expect(new Decimal(le1Val.average_unit_cost!).toFixed(4)).toBe('15.0000');
    expect(new Decimal(le1Val.valued_quantity).toFixed(3)).toBe('20.000');
    expect(new Decimal(le2Val.average_unit_cost!).toFixed(4)).toBe('50.0000');
    expect(new Decimal(le2Val.valued_quantity).toFixed(3)).toBe('5.000');
  });

  it('Scenario 9 & Anti-criterion 4: workshop KPI parts turnover before/after comparison asserts exact expected delta', async () => {
    const kpiLe = await prisma.legalEntity.create({
      data: {
        tenant_id: tenantId,
        name: 'KPI Fixture Entity',
        country_iso: 'AT',
      },
    });
    const kpiSite = await prisma.site.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: kpiLe.id,
        code: 'SITE-KPI',
        name: 'KPI Fixture Site',
      },
    });
    await prisma.siteMembership.create({
      data: {
        tenant_id: tenantId,
        user_id: dbUserId,
        site_id: kpiSite.id,
        is_active: true,
      },
    });
    const kpiBin = await prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: kpiSite.id,
        code: 'BIN-KPI',
        name: 'KPI Bin',
        type: LocationType.bin,
      },
    });
    const kpiItem = await createItem('SKU-KPI-1');

    // Closed historical fixture period (never compared with Date.now())
    const day1 = new Date('2026-06-10T10:00:00.000Z');
    const day2 = new Date('2026-06-11T10:00:00.000Z');

    // Before: receipt 10 @ 20.00 + legacy unvalued WORKSHOP_CONSUMPTION -4 (cost_basis: null)
    const legacyReceipt = await prisma.inventoryTransaction.create({
      data: {
        tenant_id: tenantId,
        site_id: kpiSite.id,
        item_id: kpiItem.id,
        location_id: kpiBin.id,
        quantity: new Decimal(10),
        type: TransactionType.PURCHASE_RECEIPT,
        cost_basis: new Decimal(20),
        createdAt: day1,
      },
    });
    const legacyConsume = await prisma.inventoryTransaction.create({
      data: {
        tenant_id: tenantId,
        site_id: kpiSite.id,
        item_id: kpiItem.id,
        location_id: kpiBin.id,
        quantity: new Decimal(-4),
        type: TransactionType.WORKSHOP_CONSUMPTION,
        cost_basis: null,
        createdAt: day2,
      },
    });

    const beforeReport = await runInTenantContext(
      () =>
        kpiReportsService.getReport({
          siteId: kpiSite.id,
          from: '2026-06-10',
          to: '2026-06-11',
          groupBy: 'month',
        }),
      kpiSite.id,
    );

    expect(beforeReport.parts_turnover.issued_cost).toBe('0.00');
    expect(beforeReport.parts_turnover.average_stock_value).toBe('200.00');
    expect(beforeReport.parts_turnover.turnover).toBe('0.00');

    // After: backfill + outbound stamping on consumption (cost_basis = 20.0000)
    await runInTenantContext(() => valuationService.backfillTenant(tenantId));
    await prisma.inventoryTransaction.update({
      where: { id: legacyConsume.id },
      data: { cost_basis: new Decimal('20.0000') },
    });

    const afterReport = await runInTenantContext(
      () =>
        kpiReportsService.getReport({
          siteId: kpiSite.id,
          from: '2026-06-10',
          to: '2026-06-11',
          groupBy: 'month',
        }),
      kpiSite.id,
    );

    // Explicit asserted delta: issued_cost 0.00 -> 80.00, avg stock value 200.00 -> 160.00 ((200 + 120) / 2), turnover 0.00 -> 0.50
    expect(afterReport.parts_turnover.issued_cost).toBe('80.00');
    expect(afterReport.parts_turnover.average_stock_value).toBe('160.00');
    expect(afterReport.parts_turnover.turnover).toBe('0.50');
    expect(legacyReceipt.id).toBeTruthy();
  });

  it('Scenario 10: resolveLastEk returns PURCHASE_RECEIPT -> CatalogItem.cost_price -> VendorArticle.last_cost -> null', async () => {
    const item = await createItem('SKU-SCEN-10', 33.33);

    // 3. Only VendorArticle.last_cost when cost_price is null
    const itemNoCost = await createItem('SKU-SCEN-10-VA', null);
    await prisma.vendorArticle.create({
      data: {
        tenant_id: tenantId,
        vendor_id: vendorId,
        catalog_item_id: itemNoCost.id,
        vendor_article_no: 'VA-10',
        last_cost: new Decimal('44.44'),
      },
    });
    const fromVendor = await runInTenantContext(() =>
      valuationService.resolveLastEk(
        basePrisma,
        tenantId,
        defaultLegalEntityId,
        itemNoCost.id,
      ),
    );
    expect(fromVendor?.toFixed(2)).toBe('44.44');

    // 2. CatalogItem.cost_price beats VendorArticle.last_cost
    const fromCatalog = await runInTenantContext(() =>
      valuationService.resolveLastEk(
        basePrisma,
        tenantId,
        defaultLegalEntityId,
        item.id,
      ),
    );
    expect(fromCatalog?.toFixed(2)).toBe('33.33');

    // 1. Same-legal-entity PURCHASE_RECEIPT beats CatalogItem.cost_price
    await runInTenantContext(() =>
      ledgerService.recordTransactions([
        {
          itemId: item.id,
          locationId: binAId,
          quantity: 2,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 55.55,
        },
      ]),
    );
    const fromReceipt = await runInTenantContext(() =>
      valuationService.resolveLastEk(
        basePrisma,
        tenantId,
        defaultLegalEntityId,
        item.id,
      ),
    );
    expect(fromReceipt?.toFixed(2)).toBe('55.55');

    // 4. Empty when none exist
    const itemEmpty = await createItem('SKU-SCEN-10-EMPTY', null);
    const empty = await runInTenantContext(() =>
      valuationService.resolveLastEk(
        basePrisma,
        tenantId,
        defaultLegalEntityId,
        itemEmpty.id,
      ),
    );
    expect(empty).toBeNull();
  });

  it('Scenario 3b: concurrent multi-article bookings in opposite orders do not deadlock and preserve all updates', async () => {
    const itemA = await createItem('SKU-MULTI-A');
    const itemB = await createItem('SKU-MULTI-B');

    await prisma.inventoryStock.createMany({
      data: [
        {
          tenant_id: tenantId,
          site_id: defaultSiteId,
          catalog_item_id: itemA.id,
          location_id: binAId,
          quantity_on_hand: new Decimal(0),
          quantity_reserved: new Decimal(0),
        },
        {
          tenant_id: tenantId,
          site_id: defaultSiteId,
          catalog_item_id: itemB.id,
          location_id: binAId,
          quantity_on_hand: new Decimal(0),
          quantity_reserved: new Decimal(0),
        },
      ],
    });

    await Promise.all([
      runInTenantContext(() =>
        basePrisma.$transaction((tx) =>
          ledgerService.recordTransactions(
            [
              {
                itemId: itemA.id,
                locationId: binAId,
                quantity: 5,
                type: TransactionType.PURCHASE_RECEIPT,
                costBasis: 10,
              },
              {
                itemId: itemB.id,
                locationId: binAId,
                quantity: 5,
                type: TransactionType.PURCHASE_RECEIPT,
                costBasis: 30,
              },
            ],
            tx,
          ),
        ),
      ),
      runInTenantContext(() =>
        basePrisma.$transaction((tx) =>
          ledgerService.recordTransactions(
            [
              {
                itemId: itemB.id,
                locationId: binAId,
                quantity: 5,
                type: TransactionType.PURCHASE_RECEIPT,
                costBasis: 50,
              },
              {
                itemId: itemA.id,
                locationId: binAId,
                quantity: 5,
                type: TransactionType.PURCHASE_RECEIPT,
                costBasis: 20,
              },
            ],
            tx,
          ),
        ),
      ),
    ]);

    const valuations = await prisma.inventoryValuation.findMany({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: { in: [itemA.id, itemB.id] },
      },
    });
    const valA = valuations.find((v) => v.catalog_item_id === itemA.id)!;
    const valB = valuations.find((v) => v.catalog_item_id === itemB.id)!;

    expect(new Decimal(valA.valued_quantity).toFixed(3)).toBe('10.000');
    expect(new Decimal(valA.average_unit_cost!).toFixed(4)).toBe('15.0000');
    expect(new Decimal(valB.valued_quantity).toFixed(3)).toBe('10.000');
    expect(new Decimal(valB.average_unit_cost!).toFixed(4)).toBe('40.0000');
  });

  it('Scenario 5b: receipt committed during backfillTenant waits on lock and is included in the final average', async () => {
    const item = await createItem('SKU-BACKFILL-RACE');
    await prisma.inventoryStock.create({
      data: {
        tenant_id: tenantId,
        site_id: defaultSiteId,
        catalog_item_id: item.id,
        location_id: binAId,
        quantity_on_hand: new Decimal(10),
        quantity_reserved: new Decimal(0),
      },
    });
    await prisma.inventoryTransaction.create({
      data: {
        tenant_id: tenantId,
        site_id: defaultSiteId,
        item_id: item.id,
        location_id: binAId,
        quantity: new Decimal(10),
        type: TransactionType.PURCHASE_RECEIPT,
        cost_basis: new Decimal(10),
      },
    });

    let concurrentReceiptPromise: Promise<void> | null = null;
    await runInTenantContext(() =>
      basePrisma.$transaction(async (backfillTx) => {
        const originalFindMany = backfillTx.inventoryTransaction.findMany.bind(
          backfillTx.inventoryTransaction,
        );
        backfillTx.inventoryTransaction.findMany = (async (
          args: Parameters<typeof originalFindMany>[0],
        ) => {
          const rows = await originalFindMany(args);
          // Start a live receipt after backfill has read the journal, before it upserts.
          concurrentReceiptPromise = runInTenantContext(() =>
            basePrisma.$transaction((receiptTx) =>
              ledgerService.recordTransactions(
                [
                  {
                    itemId: item.id,
                    locationId: binAId,
                    quantity: 10,
                    type: TransactionType.PURCHASE_RECEIPT,
                    costBasis: 20,
                  },
                ],
                receiptTx,
              ),
            ),
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
          return rows;
        }) as typeof backfillTx.inventoryTransaction.findMany;

        await valuationService.backfillTenant(tenantId, backfillTx);
      }),
    );

    expect(concurrentReceiptPromise).not.toBeNull();
    await concurrentReceiptPromise!;

    const finalValuation = await prisma.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: defaultLegalEntityId,
        catalog_item_id: item.id,
      },
    });
    expect(new Decimal(finalValuation!.valued_quantity).toFixed(3)).toBe(
      '20.000',
    );
    expect(new Decimal(finalValuation!.average_unit_cost!).toFixed(4)).toBe(
      '15.0000',
    );
  });
});
