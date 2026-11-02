import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const MIGRATION_PATH = resolve(
  process.cwd(),
  'prisma/migrations/20261101100100_aut831_tyre_set_status_data_migration/migration.sql',
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf8');

// Extract the main UPDATE statement
const updateStatement = MIGRATION_SQL.match(
  /UPDATE\s+"tyre_sets"[\s\S]+?;\n/i,
)?.[0]?.trim();

describe('AUT-831 tyre set status data migration (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;
  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let siteAId: string;
  let siteBId: string;
  let customerAId: string;
  let customerBId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    basePrisma = app.get(PrismaService);
    tenantA = await createTestTenant(basePrisma, 'tyre-backfill-a');
    tenantB = await createTestTenant(basePrisma, 'tyre-backfill-b');
    prismaA = createTenantAwarePrisma(basePrisma, tenantA.tenantId);
    prismaB = createTenantAwarePrisma(basePrisma, tenantB.tenantId);

    const siteA = await prismaA.site.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId, code: 'MAIN' },
    });
    siteAId = siteA.id;

    const siteB = await prismaB.site.findFirstOrThrow({
      where: { tenant_id: tenantB.tenantId, code: 'MAIN' },
    });
    siteBId = siteB.id;

    const customerA = await prismaA.customer.create({
      data: {
        tenant_id: tenantA.tenantId,
        first_name: 'Customer',
        last_name: 'A',
        type: 'PRIVATE',
      },
    });
    customerAId = customerA.id;

    const customerB = await prismaB.customer.create({
      data: {
        tenant_id: tenantB.tenantId,
        first_name: 'Customer',
        last_name: 'B',
        type: 'PRIVATE',
      },
    });
    customerBId = customerB.id;
  });

  afterAll(async () => {
    if (!app) return;
    try {
      if (tenantA) await cleanupTestTenantGraph(basePrisma, tenantA.tenantId);
      if (tenantB) await cleanupTestTenantGraph(basePrisma, tenantB.tenantId);
    } finally {
      await teardownTestApp(app, basePrisma);
    }
  });

  it('converts RETURNED sets without events or with only INSPECTED events to NEW, preserving tenant isolation', async () => {
    if (!updateStatement) {
      throw new Error('Could not parse UPDATE statement from migration.sql');
    }

    // 1. Tenant A: set with NO events at all (started as RETURNED)
    const setA_noEvents = await prismaA.tyreSet.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: siteAId,
        customer_id: customerAId,
        label: 'Set A No Events',
        season: 'SUMMER',
        status: 'RETURNED',
      },
    });

    // 2. Tenant A: set with ONLY INSPECTED events (the AUT-831 bug case)
    const setA_onlyInspected = await prismaA.tyreSet.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: siteAId,
        customer_id: customerAId,
        label: 'Set A Inspected Only',
        season: 'WINTER',
        status: 'RETURNED',
      },
    });
    await prismaA.tyreSetEvent.create({
      data: {
        tenant_id: tenantA.tenantId,
        tyre_set_id: setA_onlyInspected.id,
        event_type: 'INSPECTED',
        occurred_at: new Date('2026-01-10T10:00:00.000Z'),
      },
    });
    await prismaA.tyreSetEvent.create({
      data: {
        tenant_id: tenantA.tenantId,
        tyre_set_id: setA_onlyInspected.id,
        event_type: 'INSPECTED',
        occurred_at: new Date('2026-02-10T10:00:00.000Z'),
      },
    });

    // 3. Tenant A: set with other event type (e.g. CHECK_IN, CHECK_OUT) -> stays RETURNED
    const setA_withCheckIn = await prismaA.tyreSet.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: siteAId,
        customer_id: customerAId,
        label: 'Set A With Storage Events',
        season: 'ALL_SEASON',
        status: 'RETURNED',
      },
    });
    await prismaA.tyreSetEvent.create({
      data: {
        tenant_id: tenantA.tenantId,
        tyre_set_id: setA_withCheckIn.id,
        event_type: 'CHECK_IN',
        occurred_at: new Date('2026-01-01T10:00:00.000Z'),
      },
    });

    // 4. Tenant A: set in IN_STORAGE -> unaffected by migration
    const setA_inStorage = await prismaA.tyreSet.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: siteAId,
        customer_id: customerAId,
        label: 'Set A In Storage',
        season: 'SUMMER',
        status: 'IN_STORAGE',
      },
    });

    // 5. Tenant B: set with NO events in Tenant B
    const setB_noEvents = await prismaB.tyreSet.create({
      data: {
        tenant_id: tenantB.tenantId,
        site_id: siteBId,
        customer_id: customerBId,
        label: 'Set B No Events',
        season: 'WINTER',
        status: 'RETURNED',
      },
    });

    // A Tenant A event cannot point at setB: tyre_set_events has a composite
    // (tenant_id, tyre_set_id) FK onto tyre_sets. So only independent per-tenant
    // migration is asserted below, not a rejected cross-tenant event.

    // Run the migration statement
    await basePrisma.$executeRawUnsafe(updateStatement);

    // Verify outcomes:
    // setA_noEvents: should be converted to NEW
    const freshA_noEvents = await prismaA.tyreSet.findFirst({
      where: { tenant_id: tenantA.tenantId, id: setA_noEvents.id },
    });
    expect(freshA_noEvents?.status).toBe('NEW');

    // setA_onlyInspected: should be converted to NEW (the AUT-831 bug fix)
    const freshA_onlyInspected = await prismaA.tyreSet.findFirst({
      where: { tenant_id: tenantA.tenantId, id: setA_onlyInspected.id },
    });
    expect(freshA_onlyInspected?.status).toBe('NEW');

    // setA_withCheckIn: has CHECK_IN event, must STAY RETURNED
    const freshA_withCheckIn = await prismaA.tyreSet.findFirst({
      where: { tenant_id: tenantA.tenantId, id: setA_withCheckIn.id },
    });
    expect(freshA_withCheckIn?.status).toBe('RETURNED');

    // setA_inStorage: must stay IN_STORAGE
    const freshA_inStorage = await prismaA.tyreSet.findFirst({
      where: { tenant_id: tenantA.tenantId, id: setA_inStorage.id },
    });
    expect(freshA_inStorage?.status).toBe('IN_STORAGE');

    // Tenant B: setB_noEvents must be converted to NEW under its own tenant scope
    const freshB_noEvents = await prismaB.tyreSet.findFirst({
      where: { tenant_id: tenantB.tenantId, id: setB_noEvents.id },
    });
    expect(freshB_noEvents?.status).toBe('NEW');

    // Idempotency: running migration again produces no changes
    await basePrisma.$executeRawUnsafe(updateStatement);

    const freshA_onlyInspectedAgain = await prismaA.tyreSet.findFirst({
      where: { tenant_id: tenantA.tenantId, id: setA_onlyInspected.id },
    });
    expect(freshA_onlyInspectedAgain?.status).toBe('NEW');

    const freshA_withCheckInAgain = await prismaA.tyreSet.findFirst({
      where: { tenant_id: tenantA.tenantId, id: setA_withCheckIn.id },
    });
    expect(freshA_withCheckInAgain?.status).toBe('RETURNED');
  });
});
