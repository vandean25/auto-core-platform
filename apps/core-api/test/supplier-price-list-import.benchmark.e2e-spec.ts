import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';

import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  FIXTURE_SUPPLIER_NAME,
  FIXTURE_COUNTS_LARGE,
  SUPPLIER_CSV_MAPPING,
  expectedDryRunTotals,
  generateCatalogSeedItems,
  generateSupplierPriceListCsvBuffer,
} from './fixtures/supplier-price-list.fixture.js';

// Nightly performance benchmark, excluded from the PR e2e run by
// testPathIgnorePatterns in test/jest-e2e.json. Run it with
// `npm run test:e2e:benchmark --workspace=core-api` (GitHub workflow
// "Backend E2E Benchmark (nightly)"). A dry-run of the 5,000-row fixture
// exceeding the < 10 s threshold fails the assertion, Jest exits non-zero,
// and the nightly run turns red.
describe('Supplier Price List Import benchmark (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantPrismaA: PrismaService;
  let adminTokenA: string;
  let vendorA: { id: string; name: string };

  beforeAll(async () => {
    app = await createE2eApp();

    prisma = app.get(PrismaService);
    const authService = app.get(AuthService);

    tenantA = await createTestTenant(prisma, 'spl-bench-a');
    tenantPrismaA = createTenantAwarePrisma(prisma, tenantA.tenantId);
    adminTokenA = createTestAuthToken(authService, tenantA);

    await runWithTenantContext(tenantA.tenantId, async () => {
      await tenantPrismaA.importSource.create({
        data: { tenant_id: tenantA.tenantId, key: 'supplier', label: 'Supplier' },
      });

      // Fictitious supplier name strictly used
      vendorA = await tenantPrismaA.vendor.create({
        data: {
          tenant_id: tenantA.tenantId,
          name: FIXTURE_SUPPLIER_NAME, // "Autoteile Direktvertrieb GmbH"
          email: 'bestellung@autoteile-direktvertrieb.de',
          account_number: 'VEND-ADV-001',
        },
        select: { id: true, name: true },
      });

      // Seed 3,900 catalog items for the 5,000-row benchmark
      const seedCatalogData = generateCatalogSeedItems(
        tenantA.tenantId,
        FIXTURE_COUNTS_LARGE,
      );
      await tenantPrismaA.catalogItem.createMany({
        data: seedCatalogData,
      });
    });
  }, 120000);

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId);
    await teardownTestApp(app, prisma);
  });

  // --------------------------------------------------------------------------
  // 5,000-row dry-run performance benchmark and count verification
  // --------------------------------------------------------------------------
  it('executes 5,000-row dry-run benchmark within reasonable time (< 10s) with exact counts', async () => {
    const csvBuffer5000 = generateSupplierPriceListCsvBuffer(
      FIXTURE_COUNTS_LARGE,
      ';',
    );

    const startTime = Date.now();

    const res = await request(app.getHttpServer())
      .post('/api/imports')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .field('entityType', 'SUPPLIER_PRICE_LIST')
      .field('sourceSystem', 'supplier')
      .field('mapping', JSON.stringify(SUPPLIER_CSV_MAPPING))
      .field('options', JSON.stringify({ vendor_id: vendorA.id }))
      .attach('file', csvBuffer5000, 'supplier-prices-5000.csv')
      .expect(201);

    const elapsedMs = Date.now() - startTime;

    // Verify benchmark execution time
    expect(elapsedMs).toBeLessThan(10000);

    const benchmarkJobId = res.body.id;
    expect(benchmarkJobId).toBeDefined();

    // Verify job structure and counts
    expect(res.body.status).toBe('DRY_RUN_DONE');
    expect(res.body.totals).toEqual(expectedDryRunTotals(FIXTURE_COUNTS_LARGE));

    // Verify rows endpoint returns rows
    const rowsRes = await request(app.getHttpServer())
      .get(`/api/imports/${benchmarkJobId}/rows?limit=5`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .expect(200);
    expect(rowsRes.body.data.length).toBe(5);
  }, 120000);
});
