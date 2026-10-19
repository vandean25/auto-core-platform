import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
import { runCanonicalMigrationFixtureDryRunTotalsCheck } from './helpers/canonical-migration-fixture-totals.js';

describe('legacy-import.e2e-spec.ts canonical migration totals', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let authHeader: string;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    tenant = await createTestTenant(prisma, 'legacy-import-canonical-totals');
    authHeader = `Bearer ${createTestAuthToken(authService, tenant)}`;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, prisma);
  });

  it('CREATE/ERROR/SKIP/WARNING counts for customers and vehicles', async () => {
    await runCanonicalMigrationFixtureDryRunTotalsCheck(app, authHeader, {
      customers: {
        totals: { rows: 8, create: 7, error: 1, skip: 0, update: 0 },
        warningRows: 0,
      },
      vehicles: {
        totals: { rows: 6, create: 3, error: 3, skip: 0, update: 0 },
        warningRows: 1,
      },
    });
  });
});
