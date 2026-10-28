import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp, createE2eTenant } from './helpers/e2e-suite.js';
import { cleanupTestTenantGraph } from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

jest.setTimeout(60000);

type TestScope = Awaited<ReturnType<typeof createE2eTenant>>;

async function createImportedRecords(scope: TestScope, company: string, index: number) {
  const tenantId = scope.tenantId;
  const sourceSystem = `legacy_system:${company}`;
  const [customer, vehicle, customerJob, vehicleJob] = await Promise.all([
    scope.prisma.customer.create({ data: {
      tenant_id: tenantId, type: index === 1 ? 'COMPANY' : 'PRIVATE',
      first_name: 'Mira', last_name: `Example ${index}`,
      company_name: index === 1 ? 'Example Workshop' : null,
    } }),
    scope.prisma.vehicle.create({ data: {
      tenant_id: tenantId, make: 'Example Motors', model: `Road ${index}`, year: 2020,
      vin: `ZZZ${String(index + 1).padStart(14, '0')}`,
    } }),
    scope.prisma.importJob.create({ data: {
      tenant_id: tenantId, entity_type: 'CUSTOMER', source_system: sourceSystem,
      file_name: 'customers.csv', file_sha256: 'a'.repeat(64),
      mapping_json: {}, options_json: {}, totals_json: {},
    } }),
    scope.prisma.importJob.create({ data: {
      tenant_id: tenantId, entity_type: 'VEHICLE', source_system: sourceSystem,
      file_name: 'vehicles.csv', file_sha256: 'b'.repeat(64),
      mapping_json: {}, options_json: {}, totals_json: {},
    } }),
  ]);
  await scope.prisma.externalIdMapping.createMany({ data: [
    { tenant_id: tenantId, entity_type: 'CUSTOMER', source_system: sourceSystem,
      external_id: '00123', entity_id: customer.id, first_seen_import_job_id: customerJob.id },
    { tenant_id: tenantId, entity_type: 'VEHICLE', source_system: sourceSystem,
      external_id: '00123', entity_id: vehicle.id, first_seen_import_job_id: vehicleJob.id },
  ] });
  return { customer, vehicle, customerJob, vehicleJob, sourceSystem };
}

describe('Legacy customer and vehicle number search', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let primary: TestScope;
  let other: TestScope;
  let companyA: Awaited<ReturnType<typeof createImportedRecords>>;
  let companyB: Awaited<ReturnType<typeof createImportedRecords>>;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    [primary, other] = await Promise.all([
      createE2eTenant(app, prisma, 'legacy-number-primary'),
      createE2eTenant(app, prisma, 'legacy-number-other'),
    ]);
    const records = await Promise.all([
      createImportedRecords(primary, 'company_a', 0),
      createImportedRecords(primary, 'company_b', 1),
      createImportedRecords(other, 'company_a', 2),
    ]);
    [companyA, companyB] = records;
    const foreign = records[2];
    await Promise.all([
      primary.prisma.externalIdMapping.createMany({ data: [
        { tenant_id: primary.tenantId, entity_type: 'CUSTOMER', source_system: 'alternate_system:company_a',
          external_id: '00123', entity_id: companyA.customer.id, first_seen_import_job_id: companyA.customerJob.id },
        { tenant_id: primary.tenantId, entity_type: 'VEHICLE', source_system: 'alternate_system:company_a',
          external_id: '00123', entity_id: companyA.vehicle.id, first_seen_import_job_id: companyA.vehicleJob.id },
      ] }),
      other.prisma.externalIdMapping.createMany({ data: [
        { tenant_id: other.tenantId, entity_type: 'CUSTOMER', source_system: foreign.sourceSystem,
          external_id: '00999', entity_id: foreign.customer.id, first_seen_import_job_id: foreign.customerJob.id },
        { tenant_id: other.tenantId, entity_type: 'VEHICLE', source_system: foreign.sourceSystem,
          external_id: '00999', entity_id: foreign.vehicle.id, first_seen_import_job_id: foreign.vehicleJob.id },
      ] }),
    ]);
  });

  afterAll(async () => {
    if (!app) return;
    try {
      if (primary) await cleanupTestTenantGraph(prisma, primary.tenantId);
      if (other) await cleanupTestTenantGraph(prisma, other.tenantId);
    } finally {
      await teardownTestApp(app, prisma);
    }
  });

  const get = (path: string) => request(app.getHttpServer()).get(path)
    .set('Authorization', `Bearer ${primary.authToken}`);

  it.each(['customers', 'vehicles'] as const)('returns separate %s for equal numbers in two source companies', async (endpoint) => {
    const response = await get(`/api/${endpoint}`).query({ search: '00123', pageSize: 25 }).expect(200);
    const entity = endpoint === 'customers' ? 'customer' : 'vehicle';
    expect(response.body.data.map((row: { id: string }) => row.id).sort()).toEqual(
      [companyA[entity].id, companyB[entity].id].sort(),
    );
    expect(response.body.meta.total).toBe(2);
    const first = response.body.data.find((row: { id: string }) => row.id === companyA[entity].id);
    expect(first.legacy_ids).toEqual([
      { source_system: 'alternate_system:company_a', external_id: '00123' },
      { source_system: 'legacy_system:company_a', external_id: '00123' },
    ]);
  });

  it.each(['customers', 'vehicles'] as const)('never matches another tenant legacy number in %s', async (endpoint) => {
    const response = await get(`/api/${endpoint}`).query({ search: '00999' }).expect(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  it.each(['customers', 'vehicles'] as const)('does not partially match legacy numbers in %s', async (endpoint) => {
    const response = await get(`/api/${endpoint}`).query({ search: '123' }).expect(200);
    expect(response.body.data).toEqual([]);
  });

  it.each(['customers', 'vehicles'] as const)('paginates matching %s without counting duplicate mappings', async (endpoint) => {
    const response = await get(`/api/${endpoint}`).query({ search: '00123', page: 2, pageSize: 1 }).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta).toMatchObject({ total: 2, page: 2, pageSize: 1, pageCount: 2 });
  });

  it('keeps the customer type filter when a legacy number matches', async () => {
    const response = await get('/api/customers').query({ search: '00123', type: 'COMPANY' }).expect(200);
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([companyB.customer.id]);
  });

  it.each(['customers', 'vehicles'] as const)('shows all source numbers on %s detail', async (endpoint) => {
    const entity = endpoint === 'customers' ? 'customer' : 'vehicle';
    const response = await get(`/api/${endpoint}/${companyA[entity].id}`).expect(200);
    expect(response.body.legacy_ids).toEqual([
      { source_system: 'alternate_system:company_a', external_id: '00123' },
      { source_system: 'legacy_system:company_a', external_id: '00123' },
    ]);
  });
});
