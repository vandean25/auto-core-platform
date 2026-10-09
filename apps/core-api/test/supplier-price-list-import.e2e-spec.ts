import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  FIXTURE_SUPPLIER_NAME,
  FIXTURE_COUNTS,
  SUPPLIER_CSV_MAPPING,
  generateCatalogSeedItems,
  generateSupplierPriceList5000CsvBuffer,
} from './fixtures/supplier-price-list-5000.fixture.js';

describe('Supplier Price List Import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantB: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantPrismaA: ReturnType<typeof createTenantAwarePrisma>;
  let tenantPrismaB: ReturnType<typeof createTenantAwarePrisma>;

  let adminTokenA: string;
  let ownerTokenA: string;
  let techTokenA: string;
  let adminTokenB: string;

  let vendorA: { id: string; name: string };
  let vendorB: { id: string; name: string };

  let targetCatalogItemId: string;
  let historicalSalesOrderItemId: string;
  let historicalInvoiceItemId: string;
  let historicalWorkshopTaskLineItemId: string;

  let benchmarkJobId: string;
  let csvBuffer5000: Buffer;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    // 1. Create Tenant A and Tenant B
    tenantA = await createTestTenant(prisma, 'spl-a');
    tenantB = await createTestTenant(prisma, 'spl-b');
    tenantPrismaA = createTenantAwarePrisma(prisma, tenantA.tenantId);
    tenantPrismaB = createTenantAwarePrisma(prisma, tenantB.tenantId);

    // Admin token for Tenant A
    adminTokenA = createTestAuthToken(authService, tenantA);

    // Owner user and token for Tenant A
    const ownerUser = await prisma.user.create({
      data: {
        firebaseUid: `e2e-owner-${tenantA.tenantId}`,
        email: `owner-${tenantA.tenantId}@example.com`,
      },
    });
    await seedTestTenantMember(prisma, {
      tenantId: tenantA.tenantId,
      userId: ownerUser.id,
      role: 'OWNER',
    });
    ownerTokenA = authService.createTestToken({
      sub: ownerUser.firebaseUid,
      email: ownerUser.email,
      tenantId: tenantA.tenantId,
      role: 'OWNER',
    });

    // Tech user and token for Tenant A
    const techUser = await prisma.user.create({
      data: {
        firebaseUid: `e2e-tech-${tenantA.tenantId}`,
        email: `tech-${tenantA.tenantId}@example.com`,
      },
    });
    await seedTestTenantMember(prisma, {
      tenantId: tenantA.tenantId,
      userId: techUser.id,
      role: 'TECH',
    });
    techTokenA = authService.createTestToken({
      sub: techUser.firebaseUid,
      email: techUser.email,
      tenantId: tenantA.tenantId,
      role: 'TECH',
    });

    // Admin token for Tenant B
    adminTokenB = createTestAuthToken(authService, tenantB);

    // 2. Setup Tenant A data inside tenant context
    await runWithTenantContext(tenantA.tenantId, async () => {
      // Create Vendor A (fictitious supplier name strictly used)
      vendorA = await tenantPrismaA.vendor.create({
        data: {
          tenant_id: tenantA.tenantId,
          name: FIXTURE_SUPPLIER_NAME, // "Autoteile Direktvertrieb GmbH"
          email: 'bestellung@autoteile-direktvertrieb.de',
          account_number: 'VEND-ADV-001',
        },
        select: { id: true, name: true },
      });

      // Seed 3,900 catalog items for Tenant A
      const seedCatalogData = generateCatalogSeedItems(tenantA.tenantId);
      await tenantPrismaA.catalogItem.createMany({
        data: seedCatalogData,
      });

      // Target item that will be updated in the import (ADV-UPD-00001)
      const targetItem = await tenantPrismaA.catalogItem.findFirstOrThrow({
        where: {
          tenant_id: tenantA.tenantId,
          sku: 'ADV-UPD-00001',
        },
      });
      targetCatalogItemId = targetItem.id;
      expect(Number(targetItem.cost_price)).toBe(10.0);
      expect(Number(targetItem.retail_price)).toBe(15.0);

      // Seed customer
      const customer = await tenantPrismaA.customer.create({
        data: {
          tenant_id: tenantA.tenantId,
          type: 'PRIVATE',
          first_name: 'E2E',
          last_name: 'Customer',
        },
      });

      // Seed SalesOrder and SalesOrderItem
      const salesOrder = await tenantPrismaA.salesOrder.create({
        data: {
          tenant_id: tenantA.tenantId,
          customer_id: customer.id,
          order_number: 'SO-HIST-001',
          status: 'CONFIRMED',
          total_amount: 36.0,
          items: {
            create: [
              {
                tenant_id: tenantA.tenantId,
                catalog_item_id: targetCatalogItemId,
                description: 'Historical Sales Order Item',
                quantity: 2,
                unit_price: 15.0, // Historical snapshot
                total: 30.0,
                tax_rate: 20.0,
              },
            ],
          },
        },
        include: { items: true },
      });
      historicalSalesOrderItemId = salesOrder.items[0].id;

      // Seed Invoice and InvoiceItem
      const invoice = await tenantPrismaA.invoice.create({
        data: {
          tenant_id: tenantA.tenantId,
          customer_id: customer.id,
          invoice_number: 'RE-HIST-001',
          status: 'PAID',
          due_date: new Date(),
          total_net: 15.0,
          total_tax: 3.0,
          total_gross: 18.0,
          items: {
            create: [
              {
                tenant_id: tenantA.tenantId,
                catalog_item_id: targetCatalogItemId,
                description: 'Historical Invoice Item',
                quantity: 1,
                unit_price: 15.0, // Historical snapshot
                tax_rate: 20.0,
                line_total: 15.0,
              },
            ],
          },
        },
        include: { items: true },
      });
      historicalInvoiceItemId = invoice.items[0].id;

      // Seed Vehicle, WorkshopOrder, WorkshopTask, WorkshopTaskLineItem
      const vehicle = await tenantPrismaA.vehicle.create({
        data: {
          tenant_id: tenantA.tenantId,
          vin: 'WBA00000000HIST01',
          plate: 'W-HIST-01',
          make: 'BMW',
          model: '320d',
          year: 2020,
        },
      });

      const workshopOrder = await tenantPrismaA.workshopOrder.create({
        data: {
          tenant_id: tenantA.tenantId,
          order_number: 'WO-HIST-001',
          vehicle_id: vehicle.id,
          customer_id: customer.id,
          odometer: 100000,
          fuel_level: 50,
          tasks: {
            create: [
              {
                title: 'Brake Inspection',
                line_items: {
                  create: [
                    {
                      type: 'PART',
                      part_execution_status: 'PENDING_PICK',
                      item_no: targetItem.sku,
                      description: 'Historical Workshop Task Part',
                      quantity: 1,
                      unit_price: 15.0, // Historical snapshot
                      catalog_item_id: targetCatalogItemId,
                    },
                  ],
                },
              },
            ],
          },
        },
        include: {
          tasks: {
            include: { line_items: true },
          },
        },
      });
      historicalWorkshopTaskLineItemId =
        workshopOrder.tasks[0].line_items[0].id;
    });

    // 3. Setup Tenant B data inside tenant context
    await runWithTenantContext(tenantB.tenantId, async () => {
      vendorB = await tenantPrismaB.vendor.create({
        data: {
          tenant_id: tenantB.tenantId,
          name: 'Isolierter Lieferant B GmbH',
          email: 'kontakt@lieferant-b.de',
          account_number: 'VEND-B-001',
        },
        select: { id: true, name: true },
      });
    });

    // 4. Generate 5,000-row CSV fixture buffer
    csvBuffer5000 = generateSupplierPriceList5000CsvBuffer(';');
  }, 120000);

  afterAll(async () => {
    // Clean up all test data before tenant graph cleanup
    await runWithTenantContext(tenantA.tenantId, async () => {
      await tenantPrismaA.workshopTaskLineItem.deleteMany({});
      await tenantPrismaA.workshopTask.deleteMany({});
      await tenantPrismaA.workshopOrder.deleteMany({});
      await tenantPrismaA.invoiceItem.deleteMany({});
      await tenantPrismaA.invoice.deleteMany({});
      await tenantPrismaA.salesOrderItem.deleteMany({});
      await tenantPrismaA.salesOrder.deleteMany({});
      await tenantPrismaA.vehicle.deleteMany({});
      await tenantPrismaA.customer.deleteMany({});
      await tenantPrismaA.catalogPriceHistory.deleteMany({});
      await tenantPrismaA.vendorArticle.deleteMany({});
      await tenantPrismaA.marginRule.deleteMany({});
    });
    await runWithTenantContext(tenantB.tenantId, async () => {
      await tenantPrismaB.catalogPriceHistory.deleteMany({});
      await tenantPrismaB.vendorArticle.deleteMany({});
      await tenantPrismaB.marginRule.deleteMany({});
    });

    await cleanupTestTenantGraph(prisma, tenantA.tenantId);
    await cleanupTestTenantGraph(prisma, tenantB.tenantId);
    await teardownTestApp(app, prisma);
  });

  // --------------------------------------------------------------------------
  // Test 1: RBAC verification (TECH receives 403, OWNER/ADMIN succeeds)
  // --------------------------------------------------------------------------
  it('enforces RBAC: TECH receives 403 on upload and margin rules; OWNER/ADMIN succeeds', async () => {
    // 1. TECH upload attempt receives 403 Forbidden
    await request(app.getHttpServer())
      .post('/api/imports')
      .set('Authorization', `Bearer ${techTokenA}`)
      .field('entityType', 'SUPPLIER_PRICE_LIST')
      .field('sourceSystem', vendorA.id)
      .field('mapping', JSON.stringify(SUPPLIER_CSV_MAPPING))
      .attach(
        'file',
        Buffer.from(
          'Lieferanten-Artikelnummer;EAN;Beschreibung;Marke;Einkaufspreis;UVP;Einheit\nADV-UPD-00001;401234500001;Bremsbelagsatz;Bosch;11,00;16,50;STK\n',
          'utf8',
        ),
        'tech-upload.csv',
      )
      .expect(403);

    // 2. TECH margin-rules creation receives 403 Forbidden
    await request(app.getHttpServer())
      .post('/api/margin-rules')
      .set('Authorization', `Bearer ${techTokenA}`)
      .send({
        name: 'Tech Rule',
        markup_percent: 25,
      })
      .expect(403);

    // 3. TECH threshold update receives 403 Forbidden
    await request(app.getHttpServer())
      .put('/api/margin-rules/threshold')
      .set('Authorization', `Bearer ${techTokenA}`)
      .send({
        price_jump_threshold_percent: 15,
      })
      .expect(403);

    // 4. ADMIN succeeds creating a margin rule
    const adminMarginRes = await request(app.getHttpServer())
      .post('/api/margin-rules')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        name: 'Standard Markup Rule',
        markup_percent: 30,
        priority: 10,
      })
      .expect(201);
    expect(adminMarginRes.body.name).toBe('Standard Markup Rule');

    // 5. OWNER succeeds listing margin rules
    const ownerListRes = await request(app.getHttpServer())
      .get('/api/margin-rules')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    expect(Array.isArray(ownerListRes.body)).toBe(true);
    expect(ownerListRes.body.length).toBeGreaterThanOrEqual(1);

    // Clean up created margin rule for cleanly isolated benchmark test
    await runWithTenantContext(tenantA.tenantId, async () => {
      await tenantPrismaA.marginRule.delete({
        where: { id: adminMarginRes.body.id },
      });
    });
  });

  // --------------------------------------------------------------------------
  // Test 2: 5,000-row dry-run performance benchmark and count verification
  // --------------------------------------------------------------------------
  it('executes 5,000-row dry-run benchmark within reasonable time (< 10s) with exact counts', async () => {
    const startTime = Date.now();

    const res = await request(app.getHttpServer())
      .post('/api/imports')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .field('entityType', 'SUPPLIER_PRICE_LIST')
      .field('sourceSystem', vendorA.id)
      .field('mapping', JSON.stringify(SUPPLIER_CSV_MAPPING))
      .field('options', JSON.stringify({ vendor_id: vendorA.id }))
      .attach('file', csvBuffer5000, 'supplier-prices-5000.csv')
      .expect(201);

    const elapsedMs = Date.now() - startTime;

    // Verify benchmark execution time
    expect(elapsedMs).toBeLessThan(10000);

    benchmarkJobId = res.body.id;
    expect(benchmarkJobId).toBeDefined();

    // Verify job structure and counts
    expect(res.body.status).toBe('DRY_RUN_DONE');
    expect(res.body.totals).toEqual({
      rows: FIXTURE_COUNTS.totalRows, // 5,000
      update:
        FIXTURE_COUNTS.updatesExpected + FIXTURE_COUNTS.priceJumpsExpected, // 2,500 + 400 = 2,900
      skip:
        FIXTURE_COUNTS.unchangedExpected + FIXTURE_COUNTS.unmatchedExpected, // 1,000 + 1,000 = 2,000
      create: 0,
      error: FIXTURE_COUNTS.errorsExpected, // 100
      flagged_jumps: FIXTURE_COUNTS.priceJumpsExpected, // 400
    });

    // Verify rows endpoint returns rows
    const rowsRes = await request(app.getHttpServer())
      .get(`/api/imports/${benchmarkJobId}/rows?limit=5`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .expect(200);
    expect(rowsRes.body.data.length).toBe(5);
  });

  // --------------------------------------------------------------------------
  // Test 3: Price jump rejection without acceptance; success with acceptance
  // --------------------------------------------------------------------------
  it('blocks apply when price jump > 20% is unaccepted, then succeeds when accepted', async () => {
    expect(benchmarkJobId).toBeDefined();

    // 1. Applying without accepting price jumps fails with 400
    const rejectRes = await request(app.getHttpServer())
      .post(`/api/imports/${benchmarkJobId}/apply`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({})
      .expect(400);

    const errCode = rejectRes.body.code ?? rejectRes.body.message;
    expect(JSON.stringify(errCode)).toContain('PRICE_JUMP_REQUIRES_ACCEPTANCE');

    // Job remains in DRY_RUN_DONE status
    const jobCheck = await request(app.getHttpServer())
      .get(`/api/imports/${benchmarkJobId}`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .expect(200);
    expect(jobCheck.body.status).toBe('DRY_RUN_DONE');

    // 2. Applying with accept_all_price_jumps: true succeeds with 200
    const applyRes = await request(app.getHttpServer())
      .post(`/api/imports/${benchmarkJobId}/apply`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ accept_all_price_jumps: true })
      .expect(200);

    expect(applyRes.body.status).toBe('APPLIED');
    expect(applyRes.body.totals.update).toBe(2900);
    expect(applyRes.body.totals.skip).toBe(2000);
    expect(applyRes.body.totals.error).toBe(100);
  }, 120000);

  // --------------------------------------------------------------------------
  // Test 4: Apply execution: verifies VendorArticle upsert and CatalogPriceHistory
  // --------------------------------------------------------------------------
  it('creates VendorArticle and CatalogPriceHistory records for applied items', async () => {
    await runWithTenantContext(tenantA.tenantId, async () => {
      // 1. Check VendorArticle for target item
      const vendorArticle = await tenantPrismaA.vendorArticle.findFirst({
        where: {
          tenant_id: tenantA.tenantId,
          vendor_id: vendorA.id,
          vendor_article_no: 'ADV-UPD-00001',
        },
      });
      expect(vendorArticle).toBeDefined();
      expect(vendorArticle?.catalog_item_id).toBe(targetCatalogItemId);
      expect(Number(vendorArticle?.last_cost)).toBe(11.0);
      expect(Number(vendorArticle?.last_rrp)).toBe(16.5);

      // 2. Check CatalogPriceHistory for target item
      const priceHistories = await tenantPrismaA.catalogPriceHistory.findMany({
        where: {
          tenant_id: tenantA.tenantId,
          catalog_item_id: targetCatalogItemId,
          import_job_id: benchmarkJobId,
        },
      });
      expect(priceHistories.length).toBe(1);
      expect(Number(priceHistories[0].old_cost)).toBe(10.0);
      expect(Number(priceHistories[0].new_cost)).toBe(11.0);
      expect(Number(priceHistories[0].old_retail)).toBe(15.0);
      expect(Number(priceHistories[0].new_retail)).toBe(15.0);

      // 3. Verify total price histories created corresponds to all updated items
      const totalPriceHistories =
        await tenantPrismaA.catalogPriceHistory.count({
          where: {
            tenant_id: tenantA.tenantId,
            import_job_id: benchmarkJobId,
          },
        });
      expect(totalPriceHistories).toBe(2900);
    });
  });

  // --------------------------------------------------------------------------
  // Test 5: Re-running identical CSV file is a no-op (idempotent)
  // --------------------------------------------------------------------------
  it('is idempotent: re-running identical CSV file produces 0 new updates and 0 new price histories', async () => {
    // Re-run dry-run with the exact same CSV
    const rerunDryRun = await request(app.getHttpServer())
      .post('/api/imports')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .field('entityType', 'SUPPLIER_PRICE_LIST')
      .field('sourceSystem', vendorA.id)
      .field('mapping', JSON.stringify(SUPPLIER_CSV_MAPPING))
      .field('options', JSON.stringify({ vendor_id: vendorA.id }))
      .attach('file', csvBuffer5000, 'supplier-prices-5000.csv')
      .expect(201);

    expect(rerunDryRun.body.status).toBe('DRY_RUN_DONE');
    // All 2,900 previously updated items are now unchanged in cost -> converted to SKIP!
    expect(rerunDryRun.body.totals.update).toBe(0);
    expect(rerunDryRun.body.totals.skip).toBe(4900); // 2,500 + 400 + 1,000 unchanged + 1,000 unmatched
    expect(rerunDryRun.body.totals.create).toBe(0);
    expect(rerunDryRun.body.totals.error).toBe(100);

    // Apply the second job
    const rerunApply = await request(app.getHttpServer())
      .post(`/api/imports/${rerunDryRun.body.id}/apply`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ accept_all_price_jumps: true })
      .expect(200);

    expect(rerunApply.body.status).toBe('APPLIED');
    expect(rerunApply.body.totals.update).toBe(0);
    expect(rerunApply.body.totals.skip).toBe(4900);

    // Exactly 0 new CatalogPriceHistory records created for the re-run job
    await runWithTenantContext(tenantA.tenantId, async () => {
      const rerunHistories = await tenantPrismaA.catalogPriceHistory.count({
        where: {
          tenant_id: tenantA.tenantId,
          import_job_id: rerunDryRun.body.id,
        },
      });
      expect(rerunHistories).toBe(0);
    });
  }, 120000);

  // --------------------------------------------------------------------------
  // Test 6: Historical immutability of documents
  // --------------------------------------------------------------------------
  it('preserves historical document prices: InvoiceItem, SalesOrderItem, WorkshopTaskLineItem retain old unit_price', async () => {
    await runWithTenantContext(tenantA.tenantId, async () => {
      // 1. Verify CatalogItem itself now has updated prices (11.00 cost)
      const updatedCatalogItem =
        await tenantPrismaA.catalogItem.findFirstOrThrow({
          where: {
            tenant_id: tenantA.tenantId,
            id: targetCatalogItemId,
          },
        });
      expect(Number(updatedCatalogItem.cost_price)).toBe(11.0);

      // 2. InvoiceItem retains its historical unit_price (15.00)
      const invoiceItem = await tenantPrismaA.invoiceItem.findFirstOrThrow({
        where: {
          tenant_id: tenantA.tenantId,
          id: historicalInvoiceItemId,
        },
      });
      expect(Number(invoiceItem.unit_price)).toBe(15.0);

      // 3. SalesOrderItem retains its historical unit_price (15.00)
      const salesOrderItem =
        await tenantPrismaA.salesOrderItem.findFirstOrThrow({
          where: {
            tenant_id: tenantA.tenantId,
            id: historicalSalesOrderItemId,
          },
        });
      expect(Number(salesOrderItem.unit_price)).toBe(15.0);

      // 4. WorkshopTaskLineItem retains its historical unit_price (15.00)
      const workshopTaskLineItem =
        await tenantPrismaA.workshopTaskLineItem.findFirstOrThrow({
          where: {
            tenant_id: tenantA.tenantId,
            id: historicalWorkshopTaskLineItemId,
          },
        });
      expect(Number(workshopTaskLineItem.unit_price)).toBe(15.0);
    });
  });

  // --------------------------------------------------------------------------
  // Test 7: Multi-tenant isolation
  // --------------------------------------------------------------------------
  it('enforces multi-tenant isolation: Tenant B cannot access Tenant A import job, vendor articles, or price history', async () => {
    expect(benchmarkJobId).toBeDefined();

    // 1. Tenant B cannot get Tenant A's import job (404)
    await request(app.getHttpServer())
      .get(`/api/imports/${benchmarkJobId}`)
      .set('Authorization', `Bearer ${adminTokenB}`)
      .expect(404);

    // 2. Tenant B cannot get Tenant A's import job rows (404)
    await request(app.getHttpServer())
      .get(`/api/imports/${benchmarkJobId}/rows`)
      .set('Authorization', `Bearer ${adminTokenB}`)
      .expect(404);

    // 3. Tenant B cannot apply Tenant A's import job (404)
    await request(app.getHttpServer())
      .post(`/api/imports/${benchmarkJobId}/apply`)
      .set('Authorization', `Bearer ${adminTokenB}`)
      .send({ accept_all_price_jumps: true })
      .expect(404);

    // 4. Database verification: Tenant B has 0 vendor articles
    await runWithTenantContext(tenantB.tenantId, async () => {
      const tenantBArticles = await tenantPrismaB.vendorArticle.count({
        where: { tenant_id: tenantB.tenantId },
      });
      expect(tenantBArticles).toBe(0);

      const tenantBHistories = await tenantPrismaB.catalogPriceHistory.count({
        where: { tenant_id: tenantB.tenantId },
      });
      expect(tenantBHistories).toBe(0);

      const tenantBJobs = await tenantPrismaB.importJob.count({
        where: { tenant_id: tenantB.tenantId },
      });
      expect(tenantBJobs).toBe(0);
    });
  });
});
