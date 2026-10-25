import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';

describe('Import background dry-run (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let authHeader: string;

  const mapping = {
    external_id: 'Kunden-Nr',
    first_name: 'Vorname',
    last_name: 'Nachname',
  };

  beforeAll(async () => {
    process.env.IMPORT_UPLOAD_STORAGE = 'local';
    process.env.IMPORT_SYNC_MAX_ROW_COUNT = '2';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    tenant = await createTestTenant(prisma, 'import-bg');
    authHeader = `Bearer ${createTestAuthToken(authService, tenant)}`;
  });

  afterAll(async () => {
    if (tenant) {
      await cleanupTestTenantGraph(prisma, tenant.tenantId);
    }
    if (app) {
      await teardownTestApp(app, prisma);
    }
  });

  it('queues a background dry-run for files above the sync row threshold', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => [
      String(1000 + i),
      `Name${i}`,
      `Family${i}`,
    ]);
    const csv = serializeCsv(
      ['Kunden-Nr', 'Vorname', 'Nachname'],
      rows,
      ';',
    );

    const createRes = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeader)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'synthetic_dms:bg')
      .field('mapping', JSON.stringify(mapping))
      .attach('file', Buffer.from(csv, 'utf8'), 'customers.csv')
      .expect(201);

    expect(createRes.body.status).toBe('APPLYING');
    expect(createRes.body.progress).toBeTruthy();

    const jobId = createRes.body.id as string;
    let job = createRes.body;
    for (let attempt = 0; attempt < 30 && job.status === 'APPLYING'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const poll = await request(app.getHttpServer())
        .get(`/imports/${jobId}`)
        .set('Authorization', authHeader)
        .expect(200);
      job = poll.body;
    }

    expect(job.status).toBe('DRY_RUN_DONE');
    expect(job.totals.rows).toBe(5);
  });
});
