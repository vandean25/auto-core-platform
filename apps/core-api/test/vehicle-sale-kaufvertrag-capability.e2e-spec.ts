import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from './helpers/e2e-suite.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Vehicle sale Kaufvertrag capability gate (AUT-918)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  let siteId: string;
  let buyerId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    const tenant = await createTestTenant(prisma, 'aut-918-kaufvertrag-cap');
    tenantId = tenant.tenantId;
    token = createTestAuthToken(app.get(AuthService), tenant);
    siteId = await resolveTestMainSiteId(prisma, tenantId);
    await prisma.user.update({
      where: { firebaseUid: tenant.firebaseUid },
      data: { active_site_id: siteId },
    });

    const scoped = createTenantAwarePrisma(prisma, tenantId);
    await scoped.legalEntity.updateMany({
      where: { tenant_id: tenantId },
      data: { country_iso: 'DE' },
    });

    const buyer = await scoped.customer.create({
      data: {
        tenant_id: tenantId,
        type: 'PRIVATE',
        first_name: 'Synthetic',
        last_name: 'Buyer',
        address_street: 'Beispielgasse 2',
        address_zip: '4020',
        address_city: 'Linz',
        address_country: 'AT',
      },
    });
    buyerId = buyer.id;
  });

  afterAll(async () => {
    if (tenantId) await cleanupTestTenantGraph(prisma, tenantId);
    await teardownTestApp(app, prisma);
  });

  async function seedSale(): Promise<string> {
    const scoped = createTenantAwarePrisma(prisma, tenantId);
    const vehicle = await scoped.vehicle.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        make: 'Demo',
        model: 'Compact 1.0',
        year: 2020,
        vin: 'DEMOVINCAP9180001',
        first_registration_date: new Date('2020-10-08T00:00:00.000Z'),
      },
    });
    const sale = await scoped.vehicleSale.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        sale_number: 'VS-CAP-918-01',
        status: 'DRAFT',
        vehicle_id: vehicle.id,
        customer_id: buyerId,
        sale_price: 18500,
        contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
        handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
        gewaehrleistung_ends_on: new Date('2028-10-08T00:00:00.000Z'),
        presumption_ends_on: new Date('2027-10-08T00:00:00.000Z'),
        gewaehrleistung_rule_version: 'at-used-vehicle-vgg-2026-10-v2',
      },
    });
    return sale.id;
  }

  it('returns CAPABILITY_UNAVAILABLE on POST for an existing sale when kaufvertragAt is off', async () => {
    const saleId = await seedSale();

    const response = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/kaufvertrag/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.code).toBe('CAPABILITY_UNAVAILABLE');
  });

  it('returns CAPABILITY_UNAVAILABLE on GET for a missing sale when kaufvertragAt is off', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/vehicle-sales/00000000-0000-4000-8000-000000000000/kaufvertrag/pdf`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.code).toBe('CAPABILITY_UNAVAILABLE');
  });
});
