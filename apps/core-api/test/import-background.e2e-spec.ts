import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import { AuthService } from '../src/auth/auth.service.js';

describe('Import background dry-run (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    const authService = app.get(AuthService);
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
      .post('/api/imports')
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
        .get(`/api/imports/${jobId}`)
        .set('Authorization', authHeader)
        .expect(200);
      job = poll.body;
    }

    expect(job.status).toBe('DRY_RUN_DONE');
    expect(job.totals.rows).toBe(5);
  });
});
