import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SystemPrismaService } from '../src/prisma/system-prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';

describe('Import sources (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let systemPrisma: SystemPrismaService;
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
    return Buffer.from(serializeCsv(headers, rows));
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
    systemPrisma = app.get(SystemPrismaService);
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
        .send({ key: 'dms-main', label: 'Legacy DMS', is_default: true })
        .expect(201);

      expect(res.body.key).toBe('dms-main');
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
        .send({ key: 'dms-main', label: 'Duplicate' })
        .expect(409)
        .expect((res) => {
          expect(res.body.code).toBe('IMPORT_SOURCE_ALREADY_EXISTS');
        });
    });

    it('rejects keys that normalize to an empty value', async () => {
      await request(app.getHttpServer())
        .post('/imports/sources')
        .set('Authorization', adminHeader)
        .send({ key: '!!!', label: 'Invalid' })
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
      expect(res.body.data.some((s: any) => s.key === 'dms-main')).toBe(true);
    });

    it('updates an import source', async () => {
      const list = await request(app.getHttpServer())
        .get('/imports/sources')
        .set('Authorization', adminHeader)
        .expect(200);

      const source = list.body.data.find((s: any) => s.key === 'dms-main');
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

    async function dryRunAndApply(csv: Buffer, fileName: string) {
      const dryRun = await request(app.getHttpServer())
        .post('/imports')
        .set('Authorization', adminHeader)
        .field('entityType', 'CUSTOMER')
        .field('sourceSystem', 'legacy-dms')
        .field('mapping', JSON.stringify(customerMapping))
        .attach('file', csv, fileName)
        .expect(201);
      const jobId = dryRun.body.id as string;
      await request(app.getHttpServer())
        .post(`/imports/${jobId}/apply`)
        .set('Authorization', adminHeader)
        .expect(202);

      const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
      const deadline = Date.now() + 10_000;
      let job = await tenantPrisma.importJob.findFirstOrThrow({
        where: { id: jobId },
      });
      while (Date.now() < deadline && job.status !== 'APPLIED') {
        await new Promise((resolve) => setTimeout(resolve, 50));
        job = await tenantPrisma.importJob.findFirstOrThrow({
          where: { id: jobId },
        });
      }
      expect(job.status).toBe('APPLIED');
    }

    it('re-import with same source does not create duplicates', async () => {
      const csv = customerCsv([
        ['100', 'PRIVATE', 'First', 'Last', 'test@example.com', '', '', 'AT'],
      ]);

      await dryRunAndApply(csv, 'first.csv');
      await dryRunAndApply(csv, 'second.csv');

      const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
      const mappings = await tenantPrisma.externalIdMapping.findMany({
        where: {
          tenant_id: tenant.tenantId,
          entity_type: 'CUSTOMER',
          source_system: 'legacy-dms',
          external_id: '100',
        },
      });
      expect(mappings.length).toBe(1);

      const customers = await tenantPrisma.customer.findMany({
        where: { tenant_id: tenant.tenantId, email: 'test@example.com' },
      });
      expect(customers.length).toBe(1);
    });
  });

  describe('role matrix', () => {
    async function createRoleHeader(
      slug: string,
      role: 'SALES' | 'TECH' | 'DEMO',
    ) {
      const roleTenant = await createTestTenant(prisma, slug);
      await runWithTenantContext(roleTenant.tenantId, async () => {
        await prisma.tenantMember.updateMany({
          where: { tenant_id: roleTenant.tenantId },
          data: { role },
        });
      });
      const header = `Bearer ${createTestAuthToken(authService, {
        ...roleTenant,
        role,
      })}`;
      return { header, roleTenant };
    }

    async function expectMutatingEndpointsForbidden(header: string) {
      const server = app.getHttpServer();
      await request(server)
        .post('/imports')
        .set('Authorization', header)
        .field('entityType', 'CUSTOMER')
        .field('sourceSystem', 'legacy-dms')
        .field('mapping', JSON.stringify(customerMapping))
        .attach(
          'file',
          customerCsv([['1', 'PRIVATE', 'A', 'B', 'a@b.com', '', '', 'AT']]),
          'c.csv',
        )
        .expect(403);
      await request(server)
        .post('/imports/sources')
        .set('Authorization', header)
        .send({ key: 'matrix', label: 'Matrix' })
        .expect(403);
      await request(server)
        .patch('/imports/sources/00000000-0000-4000-8000-000000000000')
        .set('Authorization', header)
        .send({ label: 'Matrix' })
        .expect(403);
      await request(server)
        .delete('/imports/sources/00000000-0000-4000-8000-000000000000')
        .set('Authorization', header)
        .expect(403);
      await request(server)
        .post('/imports/mapping-profiles')
        .set('Authorization', header)
        .send({
          entity_type: 'CUSTOMER',
          source_system: 'legacy-dms',
          name: 'Matrix profile',
          mapping: { external_id: 'Kunden-Nr' },
        })
        .expect(403);
      await request(server)
        .post('/imports/00000000-0000-4000-8000-000000000000/apply')
        .set('Authorization', header)
        .expect(403);
      await request(server)
        .post('/imports/00000000-0000-4000-8000-000000000000/cancel')
        .set('Authorization', header)
        .expect(403);
      await request(server)
        .post('/imports/direct-uploads')
        .set('Authorization', header)
        .send({ fileName: 'matrix.csv', size: 10 })
        .expect(403);
      await request(server)
        .post(
          '/imports/direct-uploads/00000000-0000-4000-8000-000000000000/finalize',
        )
        .set('Authorization', header)
        .send({
          fileName: 'matrix.csv',
          size: 10,
          entityType: 'CUSTOMER',
          sourceSystem: 'legacy-dms',
          mapping: customerMapping,
          options: {},
        })
        .expect(403);
    }

    it('rejects SALES role on mutating endpoints', async () => {
      const { header, roleTenant } = await createRoleHeader(
        'import-sales',
        'SALES',
      );

      await expectMutatingEndpointsForbidden(header);

      await cleanupTestTenantGraph(prisma, roleTenant.tenantId);
    });

    it('rejects TECH role on mutating endpoints', async () => {
      const { header, roleTenant } = await createRoleHeader(
        'import-tech-src',
        'TECH',
      );

      await expectMutatingEndpointsForbidden(header);

      await cleanupTestTenantGraph(prisma, roleTenant.tenantId);
    });

    it('rejects DEMO role on mutating endpoints', async () => {
      const { header, roleTenant } = await createRoleHeader(
        'import-demo-src',
        'DEMO',
      );
      const demoUser = await prisma.user.findFirstOrThrow({
        where: { firebaseUid: roleTenant.firebaseUid },
        select: { id: true },
      });
      const accessRequest = await systemPrisma.landingDemoAccessRequest.create({
        data: {
          email: roleTenant.email,
          name: 'Demo E2E',
          betrieb: 'E2E',
          consent_recorded_at: new Date(),
        },
        select: { id: true },
      });
      await systemPrisma.landingDemoSignInGrant.create({
        data: {
          access_request_id: accessRequest.id,
          user_id: demoUser.id,
          expires_at: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      try {
        await expectMutatingEndpointsForbidden(header);
      } finally {
        await systemPrisma.landingDemoSignInGrant.deleteMany({
          where: { user_id: demoUser.id },
        });
        await systemPrisma.landingDemoAccessRequest.delete({
          where: { id: accessRequest.id },
        });
      }

      await cleanupTestTenantGraph(prisma, roleTenant.tenantId);
    });

    it('rejects tenant API keys on mutating endpoints', async () => {
      const created = await request(app.getHttpServer())
        .post('/tenant-api-keys')
        .set('Authorization', adminHeader)
        .send({ name: 'Role matrix key', scopes: ['customers:read'] })
        .expect(201);

      await expectMutatingEndpointsForbidden(`Bearer ${created.body.token}`);
    });
  });
});
