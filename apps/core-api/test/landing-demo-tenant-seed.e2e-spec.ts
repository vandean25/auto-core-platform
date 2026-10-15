import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const apiRoot = join(process.cwd());

function runLandingDemoSeed(slug: string): void {
  execSync('npm run db:seed:landing-demo-tenant', {
    cwd: apiRoot,
    env: {
      ...process.env,
      LANDING_DEMO_TENANT_SLUG: slug,
    },
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

describe('Landing demo tenant seed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `e2e-landing-demo-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (tenant) {
      await cleanupTestTenantGraph(prisma, tenant.id);
    }
    if (app) {
      await teardownTestApp(app, prisma);
    }
  });

  it('is rerun-safe for the same tenant slug', async () => {
    runLandingDemoSeed(slug);
    runLandingDemoSeed(slug);

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { slug },
      select: { id: true, is_landing_demo_tenant: true },
    });

    expect(tenant.is_landing_demo_tenant).toBe(true);

    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.id);
    const brandCount = await tenantPrisma.brand.count();
    const catalogCount = await tenantPrisma.catalogItem.count();

    expect(brandCount).toBeGreaterThan(0);
    expect(catalogCount).toBeGreaterThan(0);
  });
});
