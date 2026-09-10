import { ConflictException, INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { AtpService } from '../src/inventory/atp.service';
import { processSaleInventoryDeduction } from '../src/sales/helpers/invoice-inventory.helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  runWithTenantContext,
  type TestTenantResult,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Sales multi-stock concurrency (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let atpService: AtpService;
  let tenant: TestTenantResult;
  let tenantPrisma: PrismaService;
  let siteId: string;
  let catalogItemIds: [string, string];
  let stockIds: [string, string];

  beforeAll(async () => {
    jest.setTimeout(15000);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    atpService = app.get(AtpService);
  });

  beforeEach(async () => {
    tenant = await createTestTenant(basePrisma, 'sales-concurrency');
    tenantPrisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    const site = await tenantPrisma.site.findFirstOrThrow({
      where: { code: 'MAIN' },
    });
    siteId = site.id;

    const [firstItem, secondItem] = await Promise.all([
      tenantPrisma.catalogItem.create({
        data: {
          sku: `SALES-A-${Date.now()}`,
          name: 'Sales part A',
          retail_price: 20,
        },
      }),
      tenantPrisma.catalogItem.create({
        data: {
          sku: `SALES-B-${Date.now()}`,
          name: 'Sales part B',
          retail_price: 30,
        },
      }),
    ]);
    catalogItemIds = [firstItem.id, secondItem.id];

    const [firstLocation, secondLocation] = await Promise.all([
      tenantPrisma.storageLocation.create({
        data: {
          site_id: siteId,
          code: `SALES-BIN-A-${Date.now()}`,
          name: 'Sales bin A',
          type: 'bin',
        },
      }),
      tenantPrisma.storageLocation.create({
        data: {
          site_id: siteId,
          code: `SALES-BIN-B-${Date.now()}`,
          name: 'Sales bin B',
          type: 'bin',
        },
      }),
    ]);

    const [firstStock, secondStock] = await Promise.all([
      tenantPrisma.inventoryStock.create({
        data: {
          catalog_item_id: firstItem.id,
          location_id: firstLocation.id,
          quantity_on_hand: 1,
        },
      }),
      tenantPrisma.inventoryStock.create({
        data: {
          catalog_item_id: secondItem.id,
          location_id: secondLocation.id,
          quantity_on_hand: 1,
        },
      }),
    ]);
    stockIds = [firstStock.id, secondStock.id];
  });

  afterEach(async () => {
    await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
  });

  afterAll(async () => {
    await teardownTestApp(app, basePrisma);
  });

  it('avoids deadlock when concurrent sales contend for multiple stock rows', async () => {
    const invoiceItems = catalogItemIds.map((catalogItemId) => ({
      catalog_item_id: catalogItemId,
      description: catalogItemId,
      quantity: new Prisma.Decimal('1'),
    }));

    const runSale = (invoiceNumber: string) =>
      runWithTenantContext(tenant.tenantId, () =>
        basePrisma.$transaction(
          (tx) =>
            processSaleInventoryDeduction({
              tx,
              tenantId: tenant.tenantId,
              siteId,
              invoiceItems: invoiceItems as never,
              invoiceNumber,
              atpService,
            }),
          { maxWait: 1000, timeout: 5000 },
        ),
      );

    const outcomes = await Promise.allSettled([
      runSale('RE-CONCURRENCY-A'),
      runSale('RE-CONCURRENCY-B'),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictException),
    });

    const stocks = await tenantPrisma.inventoryStock.findMany({
      where: { id: { in: stockIds } },
      orderBy: { id: 'asc' },
    });
    expect(stocks.map((stock) => stock.quantity_on_hand)).toEqual([
      new Prisma.Decimal('0'),
      new Prisma.Decimal('0'),
    ]);

    const ledgerCount = await tenantPrisma.inventoryTransaction.count({});
    expect(ledgerCount).toBe(2);
  });
});
