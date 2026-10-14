import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../../src/common/index.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { installFakeInvoiceArchiveStorage } from '../invoice-branding-archive-test-utils.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from '../tenant-test-utils.js';

/**
 * Boots the full AppModule the way the API runs (`/api` prefix, global validation pipe) and swaps
 * invoice archive storage for the in-memory fake that suites read back from.
 */
export async function bootstrapE2eApp() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createGlobalValidationPipe());
  await app.init();
  const archiveReadKeys = installFakeInvoiceArchiveStorage(app).readKeys;

  return {
    app,
    archiveReadKeys,
    basePrisma: app.get<PrismaService>(PrismaService),
  };
}

/**
 * Creates a tenant, its owner's auth token, and a Prisma client scoped to that tenant.
 * `prefix` only names the tenant; omit it to use the default prefix.
 */
export async function createE2eTenant(
  app: INestApplication,
  basePrisma: PrismaService,
  prefix?: string,
) {
  const testTenant = await createTestTenant(basePrisma, prefix);

  return {
    tenantId: testTenant.tenantId,
    prisma: createTenantAwarePrisma(basePrisma, testTenant.tenantId),
    authToken: createTestAuthToken(app.get(AuthService), testTenant),
  };
}

/**
 * Removes the document-branding rows that invoicing suites create. Call it before
 * `cleanupTestTenantGraph`.
 */
export async function deleteDocumentBrandRows(
  basePrisma: PrismaService,
  prisma: PrismaService,
  tenantId: string,
) {
  await basePrisma.$executeRawUnsafe(
    'DELETE FROM "invoice_brand_asset_references" WHERE "tenant_id" = $1',
    tenantId,
  );
  await prisma.documentBrandProfile.deleteMany();
  await prisma.documentBrandAsset.deleteMany();
}
