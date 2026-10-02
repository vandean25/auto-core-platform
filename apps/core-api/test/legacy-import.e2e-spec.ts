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
import { IMPORT_MAX_ROW_COUNT } from '../src/import/import.constants.js';
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
      .expect(400);
  });
});
