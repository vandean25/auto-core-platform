import { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { createGlobalValidationPipe } from '../../src/common/index.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { seedReadySellerAndAccountingProfile } from '../invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from '../test-lifecycle.js';
import { cleanupTestTenantGraph } from '../tenant-test-utils.js';
import { installFakeInvoiceArchiveStorage } from '../invoice-branding-archive-test-utils.js';
import { createE2eTenant, deleteDocumentBrandRows } from './e2e-suite.js';

// Locks every posting date this run can produce: postings use the current time, which falls in
// the current year, so a lock at the end of next year is always ahead of it.
export const fiscalLockDate = `${new Date().getUTCFullYear() + 1}-12-31T00:00:00.000Z`;

export function vin(tag: string) {
  return `WVW${tag
    .replace(/[^A-Z0-9]/gi, 'X')
    .toUpperCase()
    .padEnd(14, '0')
    .slice(0, 14)}`;
}

/**
 * Shared fixture for the vehicle-stock specs: a tenant and a second tenant, a vendor, a private
 * seller and buyer, a ready seller with a margin-scheme accounting profile, and the factories the
 * specs use to receive purchases and add lot sites.
 */
export async function createVehicleStockSuite(options?: {
  configureModule?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}) {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options?.configureModule) {
    builder = options.configureModule(builder);
  }
  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createGlobalValidationPipe());
  await app.init();
  const archiveReadKeys = installFakeInvoiceArchiveStorage(app).readKeys;
  const basePrisma = app.get<PrismaService>(PrismaService);
  const { tenantId, prisma, authToken } = await createE2eTenant(
    app,
    basePrisma,
    'vehicle-stock',
  );
  const other = await createE2eTenant(app, basePrisma, 'vehicle-stock-b');
  const otherTenantId = other.tenantId;
  const otherAuthToken = other.authToken;

  const vendor = await prisma.vendor.create({
    data: {
      tenant_id: tenantId,
      name: 'Used Cars GmbH',
      email: 'vendor@cars.test',
      account_number: 'VC-001',
    },
  });
  const vendorId = vendor.id;

  const seller = await prisma.customer.create({
    data: {
      tenant_id: tenantId,
      first_name: 'Private',
      last_name: 'Seller',
      email: 'seller@test.com',
      type: 'PRIVATE',
    },
  });
  const sellerCustomerId = seller.id;

  const buyer = await prisma.customer.create({
    data: {
      tenant_id: tenantId,
      first_name: 'Buyer',
      last_name: 'Person',
      email: 'buyer@test.com',
      type: 'PRIVATE',
      address_street: 'Käufergasse 1',
      address_zip: '1010',
      address_city: 'Wien',
      address_country: 'AT',
    },
  });
  const buyerId = buyer.id;

  await seedReadySellerAndAccountingProfile(prisma, tenantId, {
    includeVehicleMargin: true,
  });
  const legalEntityId = (
    await prisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantId },
      select: { id: true },
    })
  ).id;

  async function createAndReceive(opts: {
    vin: string;
    sellerType: 'VENDOR' | 'CUSTOMER';
    price?: number;
  }) {
    const createRes = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: opts.sellerType,
        vendor_id: opts.sellerType === 'VENDOR' ? vendorId : undefined,
        customer_id:
          opts.sellerType === 'CUSTOMER' ? sellerCustomerId : undefined,
        vin: opts.vin,
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
        purchase_price: opts.price ?? 10000,
      })
      .expect(201);

    const receiveRes = await request(app.getHttpServer())
      .post(`/api/vehicle-purchases/${createRes.body.id}/receive`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    return { purchase: createRes.body, received: receiveRes.body };
  }

  async function createAdditionalLotSite(options: {
    code: string;
    isActive?: boolean;
    grantMembership?: boolean;
    separateLegalEntity?: boolean;
  }) {
    // Tenants can hold several legal entities, and a lookup by tenant alone is not deterministic.
    // The tenant's MAIN site decides which entity a new lot belongs to.
    const mainSite = await prisma.site.findFirstOrThrow({
      where: { tenant_id: tenantId, code: 'MAIN' },
      select: { legal_entity_id: true },
    });
    const currentEntity = await prisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantId, id: mainSite.legal_entity_id },
    });
    const legalEntity = options.separateLegalEntity
      ? await prisma.legalEntity.create({
          data: {
            tenant_id: tenantId,
            name: `${options.code} GmbH`,
            country_iso: 'AT',
            is_active: true,
          },
        })
      : currentEntity;
    const site = await prisma.site.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntity.id,
        code: options.code,
        name: `${options.code} Site`,
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: options.isActive ?? true,
      },
    });
    const lot = await prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: site.id,
        code: `${options.code}-LOT`,
        name: `${options.code} Vehicle Lot`,
        type: 'vehicle_lot',
      },
    });

    if (options.grantMembership) {
      const user = await basePrisma.user.findFirstOrThrow({
        where: { firebaseUid: `e2e-user-${tenantId}` },
      });
      await prisma.siteMembership.create({
        data: {
          tenant_id: tenantId,
          user_id: user.id,
          site_id: site.id,
          is_active: true,
        },
      });
    }

    return { site, lot };
  }

  return {
    app,
    basePrisma,
    prisma,
    tenantId,
    otherTenantId,
    authToken,
    otherAuthToken,
    vendorId,
    sellerCustomerId,
    buyerId,
    legalEntityId,
    archiveReadKeys,
    createAndReceive,
    createAdditionalLotSite,
  };
}

export type VehicleStockSuite = Awaited<
  ReturnType<typeof createVehicleStockSuite>
>;

/**
 * Removes the vehicle-stock fixture: brand rows and the tenant graphs first, then the app.
 */
export async function disposeVehicleStockSuite({
  app,
  basePrisma,
  prisma,
  tenantId,
  otherTenantId,
}: {
  app: INestApplication;
  basePrisma: PrismaService;
  prisma: PrismaService;
  tenantId?: string;
  otherTenantId?: string;
}) {
  if (tenantId) {
    await deleteDocumentBrandRows(basePrisma, prisma, tenantId);
    await cleanupTestTenantGraph(basePrisma, tenantId);
  }
  if (otherTenantId) {
    await cleanupTestTenantGraph(basePrisma, otherTenantId);
  }
  await teardownTestApp(app, basePrisma);
}
