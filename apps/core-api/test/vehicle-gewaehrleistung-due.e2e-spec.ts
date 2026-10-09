import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  createTenantAwarePrisma,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Vehicle Gewaehrleistung due list (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let token: string;
  let siteId: string;
  let unauthorizedSiteId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);

    const tenant = await createTestTenant(prisma, 'aut-408-gewaehrleistung-due');
    tenantId = tenant.tenantId;
    tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    token = createTestAuthToken(app.get(AuthService), tenant);
    siteId = await resolveTestMainSiteId(prisma, tenantId);
    await prisma.user.update({
      where: { firebaseUid: tenant.firebaseUid },
      data: { active_site_id: siteId },
    });
    const legalEntity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantId },
      select: { id: true },
    });
    const unauthorizedSite = await tenantPrisma.site.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntity.id,
        code: 'OTHER',
        name: 'Other authorized-scope fixture site',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: true,
      },
    });
    unauthorizedSiteId = unauthorizedSite.id;

    const otherTenant = await createTestTenant(prisma, 'aut-408-gewaehrleistung-other');
    otherTenantId = otherTenant.tenantId;
    await seedDueSales(tenantId, siteId, '00000000', unauthorizedSiteId);
    const otherSiteId = await resolveTestMainSiteId(prisma, otherTenantId);
    await seedDueSales(otherTenantId, otherSiteId, '10000000');
  });

  afterAll(async () => {
    if (tenantId) await cleanupTestTenantGraph(prisma, tenantId);
    if (otherTenantId) await cleanupTestTenantGraph(prisma, otherTenantId);
    await teardownTestApp(app, prisma);
  });

  it('returns consumer invoices inside the selected window in stable order and excludes other scopes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/vehicle-stock/gewaehrleistung-due?endsWithinDays=30')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.map((sale: { id: string }) => sale.id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(response.body.meta).toEqual({
      total: 2,
      page: 1,
      pageSize: 2,
      pageCount: 1,
    });
  });

  it.each([
    [60, [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ]],
    [90, [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000007',
    ]],
  ] as const)('returns the expected boundary rows for %i days', async (days, expectedIds) => {
    const response = await request(app.getHttpServer())
      .get(`/api/vehicle-stock/gewaehrleistung-due?endsWithinDays=${days}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.data.map((sale: { id: string }) => sale.id)).toEqual(
      expectedIds,
    );
  });

  it('rejects an unsupported window', async () => {
    await request(app.getHttpServer())
      .get('/api/vehicle-stock/gewaehrleistung-due?endsWithinDays=31')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  async function seedDueSales(
    scopeTenantId: string,
    saleSiteId: string,
    idPrefix: string,
    excludedSiteId?: string,
  ) {
    const scopedPrisma = createTenantAwarePrisma(prisma, scopeTenantId);
    const buyer = await scopedPrisma.customer.create({
      data: {
        tenant_id: scopeTenantId,
        type: 'PRIVATE',
        first_name: 'Synthetic',
        last_name: 'Buyer',
      },
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const plusDays = (days: number) => {
      const due = new Date(today);
      due.setUTCDate(due.getUTCDate() + days);
      return due;
    };
    const makeSaleId = (sequence: number) =>
      `${idPrefix}-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
    const fixtures = [
      {
        id: makeSaleId(2),
        sequence: 2,
        days: 30,
        consumer: true,
        site_id: saleSiteId,
      },
      {
        id: makeSaleId(1),
        sequence: 1,
        days: 0,
        consumer: true,
        site_id: saleSiteId,
      },
      {
        id: makeSaleId(3),
        sequence: 3,
        days: 31,
        consumer: true,
        site_id: saleSiteId,
      },
      {
        id: makeSaleId(4),
        sequence: 4,
        days: 15,
        consumer: false,
        site_id: saleSiteId,
      },
      {
        id: makeSaleId(5),
        sequence: 5,
        days: 15,
        consumer: true,
        site_id: excludedSiteId ?? saleSiteId,
      },
      {
        id: makeSaleId(6),
        sequence: 6,
        days: 15,
        consumer: true,
        site_id: saleSiteId,
      },
      {
        id: makeSaleId(7),
        sequence: 7,
        days: 90,
        consumer: true,
        site_id: saleSiteId,
      },
      {
        id: makeSaleId(8),
        sequence: 8,
        days: 91,
        consumer: true,
        site_id: saleSiteId,
      },
    ];
    await Promise.all(
      fixtures.map(async (fixture) => {
        const vehicle = await scopedPrisma.vehicle.create({
          data: {
            tenant_id: scopeTenantId,
            site_id: fixture.site_id,
            make: 'Synthetic',
            model: `Fixture ${fixture.sequence}`,
            year: 2020,
          },
        });
        await scopedPrisma.vehicleSale.create({
          data: {
            id: fixture.id,
            tenant_id: scopeTenantId,
            site_id: fixture.site_id,
            sale_number: `SYN-${String(fixture.sequence).padStart(4, '0')}`,
            status: 'INVOICED',
            vehicle_id: vehicle.id,
            customer_id: buyer.id,
            sale_price: 1000,
            buyer_is_consumer: fixture.consumer,
            gewaehrleistung_ends_on:
              fixture.sequence === 6 ? null : plusDays(fixture.days),
            presumption_ends_on: null,
            gewaehrleistung_rule_version: 'synthetic-test-rule',
          },
        });
      }),
    );
  }
});
