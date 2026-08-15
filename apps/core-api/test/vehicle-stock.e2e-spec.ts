import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

function vin(tag: string) {
  return `WVW${tag.replace(/[^A-Z0-9]/gi, 'X').toUpperCase().padEnd(14, '0').slice(0, 14)}`;
}

describe('Vehicle stock trading (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let otherAuthToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let vendorId: string;
  let sellerCustomerId: string;
  let buyerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'vehicle-stock');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = app.get(AuthService).createTestToken({ tenantId });

    const otherTenant = await createTestTenant(basePrisma, 'vehicle-stock-b');
    otherTenantId = otherTenant.tenantId;
    otherAuthToken = app.get(AuthService).createTestToken({
      tenantId: otherTenantId,
    });

    const vendor = await prisma.vendor.create({
      data: {
        name: 'Used Cars GmbH',
        email: 'vendor@cars.test',
        account_number: 'VC-001',
      },
    });
    vendorId = vendor.id;

    const seller = await prisma.customer.create({
      data: {
        first_name: 'Private',
        last_name: 'Seller',
        email: 'seller@test.com',
        type: 'PRIVATE',
      },
    });
    sellerCustomerId = seller.id;

    const buyer = await prisma.customer.create({
      data: {
        first_name: 'Buyer',
        last_name: 'Person',
        email: 'buyer@test.com',
        type: 'PRIVATE',
      },
    });
    buyerId = buyer.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    if (otherTenantId) {
      await cleanupTestTenantGraph(basePrisma, otherTenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

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
        customer_id: opts.sellerType === 'CUSTOMER' ? sellerCustomerId : undefined,
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

  it('receives a vendor purchase into USED IN_STOCK with a PURCHASE ledger row', async () => {
    const stockVin = vin('VENDOR01');
    const { received } = await createAndReceive({
      vin: stockVin,
      sellerType: 'VENDOR',
    });

    expect(received.status).toBe('RECEIVED');
    expect(received.vehicle_id).toBeTruthy();

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: received.vehicle_id },
    });
    expect(vehicle?.inventory_role).toBe('USED');
    expect(vehicle?.stock_status).toBe('IN_STOCK');
    expect(vehicle?.tax_scheme).toBe('MARGIN');

    const ledger = await prisma.vehicleLedgerEntry.findMany({
      where: { vehicle_id: received.vehicle_id },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].entry_type).toBe('PURCHASE');
    expect(Number(ledger[0].amount)).toBe(10000);
  });

  it('receives a private customer purchase', async () => {
    const { received } = await createAndReceive({
      vin: vin('PRIVATE01'),
      sellerType: 'CUSTOMER',
    });
    expect(received.status).toBe('RECEIVED');
    const purchase = await prisma.vehiclePurchase.findFirst({
      where: { id: received.id },
    });
    expect(purchase?.seller_type).toBe('CUSTOMER');
    expect(purchase?.customer_id).toBe(sellerCustomerId);
  });

  it('reuses an existing CUSTOMER vehicle with the same VIN', async () => {
    const reusedVin = vin('REUSE01');
    const existing = await prisma.vehicle.create({
      data: {
        customer_id: buyerId,
        make: 'VW',
        model: 'Passat',
        year: 2015,
        vin: reusedVin,
        inventory_role: 'CUSTOMER',
      },
    });

    const { received } = await createAndReceive({
      vin: reusedVin,
      sellerType: 'VENDOR',
    });
    expect(received.vehicle_id).toBe(existing.id);

    const count = await prisma.vehicle.count({ where: { vin: reusedVin } });
    expect(count).toBe(1);
  });

  it('rejects double-stock of the same VIN while IN_STOCK', async () => {
    const stockVin = vin('DOUBLE01');
    await createAndReceive({ vin: stockVin, sellerType: 'VENDOR' });

    const createRes = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: stockVin,
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
        purchase_price: 9000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/vehicle-purchases/${createRes.body.id}/receive`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);
  });

  it('capitalizes STOCK_PREP workshop cost without invoicing', async () => {
    const { received } = await createAndReceive({
      vin: vin('PREP01'),
      sellerType: 'VENDOR',
    });
    const vehicleId = received.vehicle_id as string;

    const orderRes = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicleId,
        purpose: 'STOCK_PREP',
        odometer: 80000,
        fuelLevel: 40,
      })
      .expect(201);

    const vehicleInPrep = await prisma.vehicle.findFirst({
      where: { id: vehicleId },
    });
    expect(vehicleInPrep?.stock_status).toBe('IN_PREP');

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: vehicleId,
        customer_id: buyerId,
        sale_price: 12000,
      })
      .expect(409);

    const taskRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderRes.body.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'TÜV and polish' })
      .expect(201);

    const polishSku = `POLISH-${Date.now()}`;
    await prisma.catalogItem.create({
      data: {
        sku: polishSku,
        name: 'Polish',
        cost_price: 180,
        retail_price: 500,
      },
    });

    await request(app.getHttpServer())
      .patch(
        `/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}/line-items`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          {
            type: 'PART',
            itemNo: polishSku,
            description: 'Polish',
            qty: 1,
            unitPrice: 500,
          },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(
        `/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(
        `/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}/line-items`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          {
            type: 'PART',
            itemNo: polishSku,
            description: 'Polish',
            qty: 2,
            unitPrice: 500,
          },
        ],
      })
      .expect(400);

    const restored = await prisma.vehicle.findFirst({ where: { id: vehicleId } });
    expect(restored?.stock_status).toBe('IN_STOCK');

    const costs = await prisma.vehicleLedgerEntry.findMany({
      where: { vehicle_id: vehicleId, entry_type: 'WORKSHOP_COST' },
    });
    expect(costs).toHaveLength(1);
    expect(Number(costs[0].amount)).toBe(180);

    const invoices = await prisma.invoice.count({
      where: { vehicle_id: vehicleId },
    });
    expect(invoices).toBe(0);
  });

  it('finalizes a margin sale and transfers the VIN to the buyer', async () => {
    const { received } = await createAndReceive({
      vin: vin('SALE01'),
      sellerType: 'VENDOR',
      price: 10000,
    });
    const vehicleId = received.vehicle_id as string;

    const saleRes = await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: vehicleId,
        customer_id: buyerId,
        sale_price: 12000,
      })
      .expect(201);

    const preview = await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(Number(preview.body.margin_vat_preview)).toBe(333.33);

    const finalized = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    expect(finalized.body.invoice.tax_mode).toBe('MARGIN_SCHEME');
    expect(Number(finalized.body.invoice.total_tax)).toBe(333.33);
    expect(Number(finalized.body.invoice.total_gross)).toBe(12000);
    expect(finalized.body.invoice.snapshot).toBeTruthy();

    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId } });
    expect(vehicle?.inventory_role).toBe('CUSTOMER');
    expect(vehicle?.customer_id).toBe(buyerId);
    expect(vehicle?.stock_status).toBeNull();

    const saleLedger = await prisma.vehicleLedgerEntry.findFirst({
      where: { vehicle_id: vehicleId, entry_type: 'SALE' },
    });
    expect(Number(saleLedger?.amount)).toBe(-12000);
  });

  it('charges zero margin VAT when sale price is below cost', async () => {
    const { received } = await createAndReceive({
      vin: vin('LOSS01'),
      sellerType: 'VENDOR',
      price: 10000,
    });

    const saleRes = await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: received.vehicle_id,
        customer_id: buyerId,
        sale_price: 9000,
      })
      .expect(201);

    const finalized = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    expect(Number(finalized.body.invoice.total_tax)).toBe(0);
  });

  it('returns 404 for a vehicle from another tenant', async () => {
    const { received } = await createAndReceive({
      vin: vin('XTE01'),
      sellerType: 'VENDOR',
    });

    await request(app.getHttpServer())
      .get(`/api/vehicle-stock/${received.vehicle_id}`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);
  });

  it('rejects receive when the posting date is fiscally locked', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/finance/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ lock_date: '2026-12-31T00:00:00.000Z' })
      .expect(200);

    const createRes = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: vin('LOCK01'),
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
        purchase_price: 10000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/vehicle-purchases/${createRes.body.id}/receive`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch('/api/finance/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ lock_date: null })
      .expect(200);
  });

  it('rejects a cross-tenant vendor on purchase create', async () => {
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);
    const foreignVendor = await otherPrisma.vendor.create({
      data: {
        name: 'Other Tenant Cars',
        email: 'other-vendor@cars.test',
        account_number: 'VC-OTHER',
      },
    });

    await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: foreignVendor.id,
        vin: vin('XTV01'),
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
        purchase_price: 10000,
      })
      .expect(404);
  });

  it('rejects a sale against another tenant vehicle', async () => {
    const { received } = await createAndReceive({
      vin: vin('XTS01'),
      sellerType: 'VENDOR',
    });

    await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .send({
        vehicle_id: received.vehicle_id,
        customer_id: buyerId,
        sale_price: 12000,
      })
      .expect(404);
  });

  it('reserves a stock vehicle for a same-tenant customer', async () => {
    const { received } = await createAndReceive({
      vin: vin('RSV01'),
      sellerType: 'VENDOR',
    });
    const vehicleId = received.vehicle_id as string;

    const reserved = await request(app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reserved_for_customer_id: buyerId })
      .expect(200);

    expect(reserved.body.stock_status).toBe('RESERVED');
    expect(reserved.body.reserved_for_customer.id).toBe(buyerId);

    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);
    const foreignBuyer = await otherPrisma.customer.create({
      data: {
        first_name: 'Foreign',
        last_name: 'Buyer',
        email: 'foreign-buyer@test.com',
        type: 'PRIVATE',
      },
    });

    await request(app.getHttpServer())
      .patch(`/api/vehicle-stock/${vehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reserved_for_customer_id: foreignBuyer.id })
      .expect(404);
  });

  it('rejects sale finalize when the posting date is fiscally locked', async () => {
    const { received } = await createAndReceive({
      vin: vin('LOCK02'),
      sellerType: 'VENDOR',
    });

    const saleRes = await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: received.vehicle_id,
        customer_id: buyerId,
        sale_price: 12000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch('/api/finance/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ lock_date: '2026-12-31T00:00:00.000Z' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch('/api/finance/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ lock_date: null })
      .expect(200);
  });
});
