import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const CUSTOMER_MAPPING = {
  external_id: 'Kunden-Nr',
  type: 'Typ',
  first_name: 'Vorname',
  last_name: 'Nachname',
};

describe('Import source backfill (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantPrisma: PrismaService;
  let adminHeader: string;
  let backfillSql: string;

  async function runBackfill() {
    await basePrisma.$executeRawUnsafe(backfillSql);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    tenant = await createTestTenant(basePrisma, 'import-source-backfill');
    tenantPrisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    adminHeader = `Bearer ${createTestAuthToken(app.get(AuthService), tenant)}`;

    const migration = await readFile(
      resolve(
        process.cwd(),
        'prisma/migrations/20261029120000_aut809_tenant_import_sources/migration.sql',
      ),
      'utf8',
    );
    const insertAt = migration.indexOf('INSERT INTO "import_sources"');
    if (insertAt < 0) {
      throw new Error('import source backfill INSERT not found in migration');
    }
    backfillSql = migration.slice(insertAt).trim();

    await tenantPrisma.importSource.deleteMany({
      where: { tenant_id: tenant.tenantId },
    });
    const job = await tenantPrisma.importJob.create({
      data: {
        tenant_id: tenant.tenantId,
        entity_type: 'CUSTOMER',
        source_system: 'old-dms-b',
        file_name: 'customers.csv',
        file_sha256: 'hash-b',
        mapping_json: {},
        options_json: {},
        totals_json: {},
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    });
    expect(job.id).toBeTruthy();
    await tenantPrisma.importMappingProfile.create({
      data: {
        tenant_id: tenant.tenantId,
        entity_type: 'CUSTOMER',
        source_system: 'old-dms-a',
        name: 'Old A mapping',
        mapping_json: {},
        createdAt: new Date('2021-01-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  it('creates one source per distinct legacy key and marks the earliest as default', async () => {
    await runBackfill();

    const sources = await tenantPrisma.importSource.findMany({
      where: { tenant_id: tenant.tenantId },
      orderBy: { key: 'asc' },
    });

    expect(sources.map((source) => source.key)).toEqual([
      'old-dms-a',
      'old-dms-b',
    ]);
    expect(sources.map((source) => source.label)).toEqual([
      'old-dms-a',
      'old-dms-b',
    ]);
    const defaults = sources.filter((source) => source.is_default);
    expect(defaults.map((source) => source.key)).toEqual(['old-dms-b']);
  });

  it('is idempotent when the backfill runs again', async () => {
    await runBackfill();

    await expect(
      tenantPrisma.importSource.count({
        where: { tenant_id: tenant.tenantId },
      }),
    ).resolves.toBe(2);
  });

  it('accepts a re-import with a backfilled source key', async () => {
    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', adminHeader)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'old-dms-a')
      .field('mapping', JSON.stringify(CUSTOMER_MAPPING))
      .attach(
        'file',
        Buffer.from(
          serializeCsv(
            ['Kunden-Nr', 'Typ', 'Vorname', 'Nachname'],
            [['200', 'PRIVATE', 'Erika', 'Muster']],
            ';',
          ),
        ),
        'customers.csv',
      )
      .expect(201);
  });
});
