import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestTenant,
} from './tenant-test-utils.js';
import { AppModule } from '../src/app.module.js';
import { teardownTestApp } from './test-lifecycle.js';
import type { INestApplication } from '@nestjs/common';

describe('Pickerl template existing-tenant backfill (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    const tenant = await createTestTenant(prisma, 'pickerl-backfill');
    tenantId = tenant.tenantId;

    const migrationPath = resolve(
      process.cwd(),
      'prisma/migrations/20261007120000_aut406_pickerl_template_existing_tenants/migration.sql',
    );
    const migration = await readFile(migrationPath, 'utf8');
    for (const statement of migration.split(';').map((part) => part.trim())) {
      if (statement) await prisma.$executeRawUnsafe(statement);
    }
  });

  afterAll(async () => {
    if (tenantId) await cleanupTestTenantGraph(prisma, tenantId);
    await teardownTestApp(app, prisma);
  });

  it('backfills the starting checklist for an existing tenant idempotently', async () => {
    const template = await prisma.inspectionTemplate.findUniqueOrThrow({
      where: {
        tenant_id_code_version: {
          tenant_id: tenantId,
          code: 'PICKERL_57A_PREP',
          version: 1,
        },
      },
    });

    await expect(
      prisma.inspectionTemplateItem.count({
        where: { tenant_id: tenantId, inspection_template_id: template.id },
      }),
    ).resolves.toBe(12);
  });
});
