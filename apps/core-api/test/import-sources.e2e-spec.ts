import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';

describe('Import sources (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let adminHeader: string;

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
    return Buffer.from(serializeCsv([headers, ...rows]));
  }

  beforeAll(async () => {
    process.env.IMPORT_MAX_ROW_COUNT = '20000';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    tenant = await createTestTenant(prisma, 'import-sources');
    adminHeader = `Bearer ${createTestAuthToken(authService, tenant)}`;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, prisma);
  });

  describe('CRUD', () => {
    it('creates an import source', async () => {
      const res = await request(app.getHttpServer())
        .post('/imports/sources')
        .set('Authorization', adminHeader)
        .send({ key: 'legacy-dms', label: 'Legacy DMS', is_default: true })
        .expect(201);

      expect(res.body.key).toBe('legacy-dms');
      expect(res.body.label).toBe('Legacy DMS');
      expect(res.body.is_default).toBe(true);
    });

    it('normalizes the key to lower-case', async () => {
      const res = await request(app.getHttpServer())
        .post('/imports/sources')
        .set('Authorization', adminHeader)
        .send({ key: '  UPPER-CASE  ', label: 'Upper Case' })
        .expect(201);

      expect(res.body.key).toBe('upper-case');
    });

    it('rejects duplicate keys', async () => {
      await request(app.getHttpServer())
        .post('/imports/sources')
        .set('Authorization', adminHeader)
        .send({ key: 'legacy-dms', label: 'Duplicate' })
        .expect(409)
        .expect((res) => {
          expect(res.body.code).toBe('IMPORT_SOURCE_ALREADY_EXISTS');
        });
    });

    it('rejects invalid keys', async () => {
      await request(app.getHttpServer())
        .post('/imports/sources')
        .set('Authorization', adminHeader)
        .send({ key: 'invalid key!', label: 'Invalid' })
        .expect(400)
        .expect((res) => {
          expect(res.body.code).toBe('IMPORT_INVALID_SOURCE_KEY');
        });
    });

    it('lists import sources', async () => {
      const res = await request(app.getHttpServer())
        .get('/imports/sources')
        .set('Authorization', adminHeader)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.some((s: any) => s.key === 'legacy-dms')).toBe(true);
    });

    it('updates an import source', async () => {
      const list = await request(app.getHttpServer())
        .get('/imports/sources')
        .set('Authorization', adminHeader)
        .expect(200);

      const source = list.body.data.find((s: any) => s.key === 'legacy-dms');
      const res = await request(app.getHttpServer())
        .patch(`/imports/sources/${source.id}`)
        .set('Authorization', adminHeader)
        .send({ label: 'Updated Label' })
        .expect(200);

      expect(res.body.label).toBe('Updated Label');
    });

    it('deletes an import source', async () => {
      const created = await request(app.getHttpServer())
        .post('/imports/sources')
        .set('Authorization', adminHeader)
        .send({ key: 'to-delete', label: 'To Delete' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/imports/sources/${created.body.id}`)
        .set('Authorization', adminHeader)
        .expect(200);

      const list = await request(app.getHttpServer())
        .get('/imports/sources')
        .set('Authorization', adminHeader)
        .expect(200);

      expect(list.body.data.some((s: any) => s.key === 'to-delete')).toBe(
        false,
      );
    });
  });

  describe('import validation', () => {
    it('rejects import with unknown source system', async () => {
      await request(app.getHttpServer())
        .post('/imports')
        .set('Authorization', adminHeader)
        .field('entityType', 'CUSTOMER')
        .field('sourceSystem', 'unknown-source')
        .field('mapping', JSON.stringify(customerMapping))
        .attach(
          'file',
          customerCsv([['1', 'PRIVATE', 'A', 'B', 'a@b.com', '', '', 'AT']]),
          'c.csv',
        )
        .expect(400)
        .expect((res) => {
          expect(res.body.code).toBe('IMPORT_UNKNOWN_SOURCE');
        });
    });

    it('accepts import with configured source system', async () => {
      await request(app.getHttpServer())
        .post('/imports')
        .set('Authorization', adminHeader)
        .field('entityType', 'CUSTOMER')
        .field('sourceSystem', 'legacy-dms')
        .field('mapping', JSON.stringify(customerMapping))
        .attach(
          'file',
          customerCsv([['1', 'PRIVATE', 'A', 'B', 'a@b.com', '', '', 'AT']]),
          'c.csv',
        )
        .expect(201);
    });

    it('re-import with same source does not create duplicates', async () => {
      const csv = customerCsv([
        ['100', 'PRIVATE', 'First', 'Last', 'test@example.com', '', '', 'AT'],
      ]);

      await request(app.getHttpServer())
        .post('/imports')
        .set('Authorization', adminHeader)
        .field('entityType', 'CUSTOMER')
        .field('sourceSystem', 'legacy-dms')
        .field('mapping', JSON.stringify(customerMapping))
        .attach('file', csv, 'first.csv')
        .expect(201);

      const job1 = await prisma.importJob.findFirst({
        where: { tenant_id: tenant.tenantId, source_system: 'legacy-dms' },
        orderBy: { createdAt: 'desc' },
      });

      await request(app.getHttpServer())
        .post('/imports')
        .set('Authorization', adminHeader)
        .field('entityType', 'CUSTOMER')
        .field('sourceSystem', 'legacy-dms')
        .field('mapping', JSON.stringify(customerMapping))
        .attach('file', csv, 'second.csv')
        .expect(201);

      const mappings = await prisma.externalIdMapping.findMany({
        where: {
          tenant_id: tenant.tenantId,
          entity_type: 'CUSTOMER',
          source_system: 'legacy-dms',
          external_id: '100',
        },
      });

      expect(mappings.length).toBe(1);
    });
  });

  describe('role matrix', () => {
    it('rejects SALES role on mutating endpoints', async () => {
      const salesTenant = await createTestTenant(prisma, 'import-sales');
      await runWithTenantContext(salesTenant.tenantId, async () => {
        await prisma.tenantMember.updateMany({
          where: { tenant_id: salesTenant.tenantId },
          data: { role: 'SALES' },
        });
      });
      const salesHeader = `Bearer ${createTestAuthToken(authService, {
        ...salesTenant,
        role: 'SALES',
      })}`;

      await request(app.getHttpServer())
        .post('/imports/sources')
        .set('Authorization', salesHeader)
        .send({ key: 'test', label: 'Test' })
        .expect(403);

      await request(app.getHttpServer())
        .post('/imports')
        .set('Authorization', salesHeader)
        .field('entityType', 'CUSTOMER')
        .field('sourceSystem', 'legacy-dms')
        .field('mapping', JSON.stringify(customerMapping))
        .attach(
          'file',
          customerCsv([['1', 'PRIVATE', 'A', 'B', 'a@b.com', '', '', 'AT']]),
          'c.csv',
        )
        .expect(403);

      await cleanupTestTenantGraph(prisma, salesTenant.tenantId);
    });

    it('rejects TECH role on mutating endpoints', async () => {
      const techTenant = await createTestTenant(prisma, 'import-tech-src');
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
        .post('/imports/sources')
        .set('Authorization', techHeader)
        .send({ key: 'test', label: 'Test' })
        .expect(403);

      await cleanupTestTenantGraph(prisma, techTenant.tenantId);
    });

    it('rejects DEMO role on mutating endpoints', async () => {
      const demoTenant = await createTestTenant(prisma, 'import-demo-src');
      await runWithTenantContext(demoTenant.tenantId, async () => {
        await prisma.tenantMember.updateMany({
          where: { tenant_id: demoTenant.tenantId },
          data: { role: 'DEMO' },
        });
      });
      const demoHeader = `Bearer ${createTestAuthToken(authService, {
        ...demoTenant,
        role: 'DEMO',
      })}`;

      await request(app.getHttpServer())
        .post('/imports/sources')
        .set('Authorization', demoHeader)
        .send({ key: 'test', label: 'Test' })
        .expect(403);

      await cleanupTestTenantGraph(prisma, demoTenant.tenantId);
    });
  });

  describe('migration', () => {
    it('creates sources from existing import_jobs and mappings', async () => {
      const migrationTenant = await createTestTenant(
        prisma,
        'import-migration',
      );

      await runWithTenantContext(migrationTenant.tenantId, async () => {
        await prisma.importJob.create({
          data: {
            tenant_id: migrationTenant.tenantId,
            entity_type: 'CUSTOMER',
            source_system: 'old-system-1',
            file_name: 'test.csv',
            file_sha256: 'abc123',
            status: 'DRY_RUN_DONE',
            mapping_json: {},
            options_json: {},
            totals_json: {},
          },
        });

        await prisma.importJob.create({
          data: {
            tenant_id: migrationTenant.tenantId,
            entity_type: 'VEHICLE',
            source_system: 'old-system-2',
            file_name: 'test2.csv',
            file_sha256: 'def456',
            status: 'DRY_RUN_DONE',
            mapping_json: {},
            options_json: {},
            totals_json: {},
          },
        });
      });

      const sources = await prisma.importSource.findMany({
        where: { tenant_id: migrationTenant.tenantId },
      });

      expect(sources.length).toBe(2);
      expect(sources.some((s) => s.key === 'old-system-1')).toBe(true);
      expect(sources.some((s) => s.key === 'old-system-2')).toBe(true);

      await cleanupTestTenantGraph(prisma, migrationTenant.tenantId);
    });
  });
});
