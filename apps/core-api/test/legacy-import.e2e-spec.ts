import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROW_COUNT,
} from '../src/import/import.constants.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';

describe('Legacy CSV import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantB: Awaited<ReturnType<typeof createTestTenant>>;
  let authHeaderA: string;
  let authHeaderB: string;

  const customerMapping = {
    external_id: 'Kunden-Nr',
    type: 'Typ',
    first_name: 'Vorname',
    last_name: 'Nachname',
    email: 'E-Mail',
    phone: 'Telefon',
    vat_id: 'UID',
    address_country: 'Land',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    tenantA = await createTestTenant(prisma, 'import-a');
    tenantB = await createTestTenant(prisma, 'import-b');
    authHeaderA = `Bearer ${createTestAuthToken(authService, tenantA)}`;
    authHeaderB = `Bearer ${createTestAuthToken(authService, tenantB)}`;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId);
    await cleanupTestTenantGraph(prisma, tenantB.tenantId);
    await teardownTestApp(app, prisma);
  });

  function customerCsv(rows: string[][]) {
    const headers = [
      'Kunden-Nr',
      'Typ',
      'Vorname',
      'Nachname',
      'E-Mail',
      'Telefon',
      'UID',
      'Land',
    ];
    return Buffer.from(serializeCsv(headers, rows, ';'), 'utf8');
  }

  it('dry-run does not write customers, vehicles, or import audit rows', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const beforeCustomers = await tenantPrisma.customer.count({});
    const beforeVehicles = await tenantPrisma.vehicle.count({});
    const beforeAudit = await tenantPrisma.auditLog.count({
      where: {
        entity_type: { in: ['Customer', 'Vehicle'] },
      },
    });

    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .field('options', JSON.stringify({}))
      .attach('file', customerCsv([['9001', 'PRIVATE', 'Pilot', 'User', 'pilot@example.com', '', '', 'AT']]), 'customers.csv')
      .expect(201);

    const afterCustomers = await tenantPrisma.customer.count({});
    const afterVehicles = await tenantPrisma.vehicle.count({});
    const afterAudit = await tenantPrisma.auditLog.count({
      where: {
        entity_type: { in: ['Customer', 'Vehicle'] },
      },
    });

    expect(afterCustomers).toBe(beforeCustomers);
    expect(afterVehicles).toBe(beforeVehicles);
    expect(afterAudit).toBe(beforeAudit);
  });

  it('applies customers and is idempotent on re-upload', async () => {
    const csv = customerCsv([
      ['9100', 'PRIVATE', 'Anna', 'Import', 'anna-import@example.com', '123', '', 'AT'],
    ]);

    const dryRun = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', csv, 'customers.csv')
      .expect(201);

    await request(app.getHttpServer())
      .post(`/imports/${dryRun.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(200);

    const secondDryRun = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', csv, 'customers.csv')
      .expect(201);

    expect(secondDryRun.body.totals.skip).toBe(1);
    expect(secondDryRun.body.totals.create).toBe(0);

    await request(app.getHttpServer())
      .post(`/imports/${dryRun.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(409);
  });

  it('updates existing customer when update_existing is enabled', async () => {
    const externalId = '9200';
    const email = 'update-import@example.com';
    const baseCsv = customerCsv([
      [externalId, 'PRIVATE', 'Update', 'Me', email, '111', '', 'AT'],
    ]);

    const firstJob = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', baseCsv, 'customers.csv')
      .expect(201);

    await request(app.getHttpServer())
      .post(`/imports/${firstJob.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(200);

    const updatedCsv = customerCsv([
      [externalId, 'PRIVATE', 'Update', 'Me', email, '222', '', 'AT'],
    ]);
    const updateJob = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .field('options', JSON.stringify({ update_existing: true }))
      .attach('file', updatedCsv, 'customers.csv')
      .expect(201);

    expect(updateJob.body.totals.update).toBe(1);

    await request(app.getHttpServer())
      .post(`/imports/${updateJob.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(200);

    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const customer = await tenantPrisma.customer.findFirst({
      where: { email },
    });
    expect(customer?.phone).toBe('222');

    const audit = await tenantPrisma.auditLog.findFirst({
      where: {
        entity_type: 'Customer',
        entity_id: customer?.id,
        action: 'UPDATE',
        source: 'import',
      },
      orderBy: { occurred_at: 'desc' },
    });
    expect(audit?.diff).toBeTruthy();
  });

  it('enforces tenant isolation for import jobs', async () => {
    const job = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach(
        'file',
        customerCsv([['9300', 'PRIVATE', 'Iso', 'Late', 'iso@example.com', '', '', 'AT']]),
        'customers.csv',
      )
      .expect(201);

    await request(app.getHttpServer())
      .get(`/imports/${job.body.id}`)
      .set('Authorization', authHeaderB)
      .expect(404);
  });

  it('rejects TECH role and oversized row counts', async () => {
    const techTenant = await createTestTenant(prisma, 'import-tech');
    await runWithTenantContext(techTenant.tenantId, async () => {
      await prisma.tenantMember.updateMany({
        where: { tenant_id: techTenant.tenantId },
        data: { role: 'TECH' },
      });
    });
    const techHeader = `Bearer ${createTestAuthToken(authService, {
      ...techTenant,
      role: 'TECH',
    })}`;

    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', techHeader)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', customerCsv([['1', 'PRIVATE', 'A', 'B', 'a@b.com', '', '', 'AT']]), 'c.csv')
      .expect(403);

    await cleanupTestTenantGraph(prisma, techTenant.tenantId);

    const rows = Array.from({ length: IMPORT_MAX_ROW_COUNT + 1 }, (_, i) => [
      String(10_000 + i),
      'PRIVATE',
      'Bulk',
      'Row',
      `bulk${i}@example.com`,
      '',
      '',
      'AT',
    ]);
    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', customerCsv(rows), 'too-many.csv')
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('IMPORT_ROW_LIMIT_EXCEEDED');
      });
  });

  it('rejects an empty CSV with IMPORT_EMPTY_FILE', async () => {
    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', Buffer.from('\n', 'utf8'), 'empty.csv')
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('IMPORT_EMPTY_FILE');
      });
  });

  it('returns IMPORT_FILE_TOO_LARGE for oversized uploads', async () => {
    const big = Buffer.alloc(IMPORT_MAX_FILE_BYTES + 100, 'a');
    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', big, 'big.csv')
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('IMPORT_FILE_TOO_LARGE');
      });
  });

  it('does not duplicate customers when two dry-runs are both applied', async () => {
    const csv = customerCsv([
      ['9400', 'PRIVATE', 'Once', 'Only', 'once-only@example.com', '', '', 'AT'],
    ]);
    const job1 = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', csv, 'customers.csv')
      .expect(201);
    const job2 = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', csv, 'customers.csv')
      .expect(201);

    await request(app.getHttpServer())
      .post(`/imports/${job1.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/imports/${job2.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(200);

    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const count = await tenantPrisma.customer.count({
      where: { email: 'once-only@example.com' },
    });
    expect(count).toBe(1);
  });

  it('blocks tenant B from applying tenant A import job', async () => {
    const job = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach(
        'file',
        customerCsv([['9500', 'PRIVATE', 'Cross', 'Tenant', 'cross@example.com', '', '', 'AT']]),
        'customers.csv',
      )
      .expect(201);

    await request(app.getHttpServer())
      .post(`/imports/${job.body.id}/apply`)
      .set('Authorization', authHeaderB)
      .expect(404);

    const stillDry = await request(app.getHttpServer())
      .get(`/imports/${job.body.id}`)
      .set('Authorization', authHeaderA)
      .expect(200);
    expect(stillDry.body.status).toBe('DRY_RUN_DONE');
  });

  it('allows the same external_id in different tenants', async () => {
    const externalId = '9600';
    const csvA = customerCsv([
      [externalId, 'PRIVATE', 'Tenant', 'A', 'same-ext-a@example.com', '', '', 'AT'],
    ]);
    const csvB = customerCsv([
      [externalId, 'PRIVATE', 'Tenant', 'B', 'same-ext-b@example.com', '', '', 'AT'],
    ]);

    const jobA = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', csvA, 'a.csv')
      .expect(201);
    const jobB = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderB)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', csvB, 'b.csv')
      .expect(201);

    await request(app.getHttpServer())
      .post(`/imports/${jobA.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/imports/${jobB.body.id}/apply`)
      .set('Authorization', authHeaderB)
      .expect(200);

    const countA = await createTenantAwarePrisma(prisma, tenantA.tenantId).customer.count({
      where: { email: 'same-ext-a@example.com' },
    });
    const countB = await createTenantAwarePrisma(prisma, tenantB.tenantId).customer.count({
      where: { email: 'same-ext-b@example.com' },
    });
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it('rejects concurrent apply on the same job', async () => {
    const job = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms-slow')
      .field('mapping', JSON.stringify(customerMapping))
      .attach(
        'file',
        customerCsv([
          ['9700', 'PRIVATE', 'Concurrent', 'One', 'concurrent1@example.com', '', '', 'AT'],
          ['9701', 'PRIVATE', 'Concurrent', 'Two', 'concurrent2@example.com', '', '', 'AT'],
        ]),
        'customers.csv',
      )
      .expect(201);

    const server = app.getHttpServer();
    const apply = () =>
      request(server)
        .post(`/imports/${job.body.id}/apply`)
        .set('Authorization', authHeaderA);

    const [first, second] = await Promise.all([apply(), apply()]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('validates vehicle imports via API rows', async () => {
    const ownerCsv = customerCsv([
      ['own-1', 'PRIVATE', 'Vehicle', 'Owner', 'veh-owner@example.com', '', '', 'AT'],
    ]);
    const ownerJob = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms-veh')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', ownerCsv, 'owner.csv')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/imports/${ownerJob.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(200);

    const vehicleMapping = {
      external_id: 'Fahrzeug-Nr',
      vin: 'FIN',
      plate: 'Kennzeichen',
      make: 'Marke',
      model: 'Modell',
      year: 'Baujahr',
      owner_customer_external_id: 'Kunden-Nr',
    };
    const vehicleCsv = Buffer.from(
      [
        'Fahrzeug-Nr;FIN;Kennzeichen;Marke;Modell;Baujahr;Kunden-Nr',
        'v1;BADVIN;W-1;Make;Model;2020;own-1',
        'v2;1HGCM82633A004352;W-2;Make;Model;2020;own-1',
        'v3;1HGCM82633A004352;W-3;Make;Model;2020;own-1',
        'v4;1HGCM82633A004353;W-4;Make;Model;2020;missing-owner',
      ].join('\n'),
      'utf8',
    );

    const vehJob = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'VEHICLE')
      .field('sourceSystem', 'legacy-dms-veh')
      .field('mapping', JSON.stringify(vehicleMapping))
      .attach('file', vehicleCsv, 'vehicles.csv')
      .expect(201);

    const rows = await request(app.getHttpServer())
      .get(`/imports/${vehJob.body.id}/rows?limit=50`)
      .set('Authorization', authHeaderA)
      .expect(200);

    const codes = rows.body.data.flatMap((row: { errors: Array<{ code: string }> }) =>
      row.errors.map((error) => error.code),
    );
    expect(codes).toContain('IMPORT_VIN_INVALID');
    expect(codes).toContain('IMPORT_DUPLICATE_VIN_IN_FILE');
    expect(codes).toContain('IMPORT_UNKNOWN_OWNER');
  });

  it('applies vehicles and idempotently SKIPs on second import with update_existing', async () => {
    const ownerCsv = customerCsv([
      ['veh-own-2', 'PRIVATE', 'Veh', 'Owner', 'veh-own-2@example.com', '', '', 'AT'],
    ]);
    const ownerJob = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms-veh2')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', ownerCsv, 'owner.csv')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/imports/${ownerJob.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(200);

    const vehicleMapping = {
      external_id: 'Fahrzeug-Nr',
      vin: 'FIN',
      plate: 'Kennzeichen',
      make: 'Marke',
      model: 'Modell',
      year: 'Baujahr',
      owner_customer_external_id: 'Kunden-Nr',
    };
    const vehicleCsv = Buffer.from(
      [
        'Fahrzeug-Nr;FIN;Kennzeichen;Marke;Modell;Baujahr;Kunden-Nr',
        'veh-ext-1;1HGCM82633A004352;W-IMP-1;Make;Model;2020;veh-own-2',
      ].join('\n'),
      'utf8',
    );

    const firstJob = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'VEHICLE')
      .field('sourceSystem', 'legacy-dms-veh2')
      .field('mapping', JSON.stringify(vehicleMapping))
      .field('options', JSON.stringify({ update_existing: true }))
      .attach('file', vehicleCsv, 'vehicles.csv')
      .expect(201);

    await request(app.getHttpServer())
      .post(`/imports/${firstJob.body.id}/apply`)
      .set('Authorization', authHeaderA)
      .expect(200);

    const reimportCsv = Buffer.from(
      [
        'Fahrzeug-Nr;FIN;Kennzeichen;Marke;Modell;Baujahr;Kunden-Nr',
        'veh-ext-1;;W-IMP-1;Make;Model;2020;',
      ].join('\n'),
      'utf8',
    );
    const secondJob = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeaderA)
      .field('entityType', 'VEHICLE')
      .field('sourceSystem', 'legacy-dms-veh2')
      .field('mapping', JSON.stringify(vehicleMapping))
      .field(
        'options',
        JSON.stringify({ update_existing: true, allow_missing_vin: true }),
      )
      .attach('file', reimportCsv, 'vehicles.csv')
      .expect(201);

    expect(secondJob.body.totals.skip).toBe(secondJob.body.totals.rows);
    expect(secondJob.body.totals.update).toBe(0);
    expect(secondJob.body.totals.create).toBe(0);

    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const vehicle = await tenantPrisma.vehicle.findFirst({
      where: { vin: '1HGCM82633A004352' },
    });
    expect(vehicle?.vin).toBe('1HGCM82633A004352');
  });

  it('isolates import mapping profiles by tenant', async () => {
    const mapping = { external_id: 'Kunden-Nr', last_name: 'Nachname' };
    const created = await request(app.getHttpServer())
      .post('/imports/mapping-profiles')
      .set('Authorization', authHeaderA)
      .send({
        entity_type: 'CUSTOMER',
        source_system: 'incadea',
        name: 'Pilot profile',
        mapping,
      })
      .expect(201);

    const listB = await request(app.getHttpServer())
      .get('/imports/mapping-profiles?entityType=CUSTOMER&sourceSystem=incadea')
      .set('Authorization', authHeaderB)
      .expect(200);

    expect(listB.body.data).toEqual([]);

    const listA = await request(app.getHttpServer())
      .get('/imports/mapping-profiles?entityType=CUSTOMER&sourceSystem=incadea')
      .set('Authorization', authHeaderA)
      .expect(200);

    expect(listA.body.data).toHaveLength(1);
    expect(listA.body.data[0].id).toBe(created.body.id);
    expect(listA.body.data[0].mapping).toEqual(mapping);
  });
});
