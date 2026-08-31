import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { SANDBOX_CATALOG_ADAPTER_IDS } from '../src/catalog/catalog-adapter-ids';
import { seedVehicleCatalogProviders } from '../src/prisma/seed-vehicle-catalog-providers';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Catalog provider settings (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let adminToken: string;
  let techToken: string;
  let salesToken: string;
  const testPrefix = `catalog-settings-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(
      basePrisma,
      'catalog-provider-settings',
    );
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);

    await runWithTenantContext(tenantId, async () => {
      await seedVehicleCatalogProviders(basePrisma, tenantId);

      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: `tech-catalog-settings-${tenantId}`,
          email: `tech-catalog-settings-${tenantId}@example.com`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      techToken = createTestAuthToken(app.get(AuthService), {
        ...testTenant,
        firebaseUid: techUser.firebaseUid,
        email: techUser.email,
        role: 'TECH',
      });

      const salesUser = await basePrisma.user.create({
        data: {
          firebaseUid: `sales-catalog-settings-${tenantId}`,
          email: `sales-catalog-settings-${tenantId}@example.com`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: salesUser.id,
        role: 'SALES',
      });
      salesToken = createTestAuthToken(app.get(AuthService), {
        ...testTenant,
        firebaseUid: salesUser.firebaseUid,
        email: salesUser.email,
        role: 'SALES',
      });
    });
  });

  afterAll(async () => {
    if (tenantId) {
      await runWithTenantContext(tenantId, async () => {
        await basePrisma.catalogProviderSettings.updateMany({
          where: { tenant_id: tenantId },
          data: { default_labor_category_id: null },
        });
        await basePrisma.laborCategory.deleteMany({
          where: { tenant_id: tenantId },
        });
      });
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('GET /settings/catalog-providers returns seeded defaults and Stellantis member makes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.awMinutes).toBe(6);
    expect(response.body.defaultPartsAftermarketAdapterId).toBe(
      SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
    );
    expect(response.body.defaultLaborAftermarketAdapterId).toBe(
      SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
    );

    const stellantis = response.body.oemConcerns.find(
      (concern: { code: string }) => concern.code === 'STELLANTIS',
    );
    expect(stellantis).toBeDefined();
    expect(stellantis.memberMakes.map((make: { name: string }) => make.name)).toEqual(
      expect.arrayContaining([
        'Peugeot',
        'Citroën',
        'Opel',
        'Fiat',
        'Jeep',
      ]),
    );
  });

  it('PATCH /settings/catalog-providers updates singleton settings in place', async () => {
    const laborCategory = await prisma.laborCategory.create({
      data: {
        tenant_id: tenantId,
        name: `${testPrefix} Catalog Default Labor`,
        default_hourly_rate: 95,
      },
    });

    const first = await request(app.getHttpServer())
      .patch('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        awMinutes: 8,
        defaultLaborCategoryId: laborCategory.id,
      })
      .expect(200);

    expect(first.body.awMinutes).toBe(8);
    expect(first.body.defaultLaborCategoryId).toBe(laborCategory.id);
    expect(first.body.defaultLaborCategory).toMatchObject({
      id: laborCategory.id,
      name: `${testPrefix} Catalog Default Labor`,
      defaultHourlyRate: 95,
    });

    const second = await request(app.getHttpServer())
      .patch('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ awMinutes: 10 })
      .expect(200);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.awMinutes).toBe(10);
    expect(second.body.defaultLaborCategoryId).toBe(laborCategory.id);

    const rowCount = await prisma.catalogProviderSettings.count({
      where: { tenant_id: tenantId },
    });
    expect(rowCount).toBe(1);
  });

  it('PATCH /settings/catalog-providers saves Stellantis member makes', async () => {
    const brands = await prisma.brand.findMany({
      where: {
        tenant_id: tenantId,
        normalized_name: { in: ['PEUGEOT', 'CITROEN', 'OPEL', 'FIAT', 'JEEP'] },
      },
      orderBy: { id: 'asc' },
    });

    const response = await request(app.getHttpServer())
      .patch('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        oemConcerns: [
          {
            code: 'STELLANTIS',
            memberBrandIds: brands.map((brand) => brand.id),
          },
        ],
      })
      .expect(200);

    const stellantis = response.body.oemConcerns.find(
      (concern: { code: string }) => concern.code === 'STELLANTIS',
    );
    expect(stellantis.memberMakes).toHaveLength(brands.length);
    expect(stellantis.memberMakes.map((make: { name: string }) => make.name)).toEqual(
      expect.arrayContaining(['Peugeot', 'Citroën', 'Opel', 'Fiat', 'Jeep']),
    );
  });

  it('PATCH /settings/catalog-providers rejects labor category without hourly rate', async () => {
    const laborCategory = await prisma.laborCategory.create({
      data: {
        tenant_id: tenantId,
        name: `${testPrefix} No Rate Category`,
        default_hourly_rate: null,
      },
    });

    await request(app.getHttpServer())
      .patch('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultLaborCategoryId: laborCategory.id })
      .expect(422);
  });

  it('TECH and SALES cannot PATCH catalog provider settings', async () => {
    await request(app.getHttpServer())
      .patch('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ awMinutes: 7 })
      .expect(403);

    await request(app.getHttpServer())
      .patch('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ awMinutes: 7 })
      .expect(403);
  });

  it('TECH and SALES cannot GET catalog provider settings', async () => {
    await request(app.getHttpServer())
      .get('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${techToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(403);
  });

  it('DELETE /labor/categories returns 409 when category is default for catalog providers', async () => {
    const laborCategory = await prisma.laborCategory.create({
      data: {
        tenant_id: tenantId,
        name: `${testPrefix} Protected Default Labor`,
        default_hourly_rate: 80,
      },
    });

    await request(app.getHttpServer())
      .patch('/api/settings/catalog-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultLaborCategoryId: laborCategory.id })
      .expect(200);

    const response = await request(app.getHttpServer())
      .delete(`/api/labor/categories/${laborCategory.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    expect(response.body.message).toContain(
      'default labor category for catalog provider settings',
    );
  });
});
