import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenantAwarePrisma } from './tenant-test-utils.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  fiscalLockDate,
  vin,
} from './helpers/vehicle-stock-suite.js';
import type { VehicleStockSuite } from './helpers/vehicle-stock-suite.js';

describe('Vehicle stock trading (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let authToken: string;
  let vendorId: string;
  let sellerCustomerId: string;
  let buyerId: string;
  let createAndReceive: VehicleStockSuite['createAndReceive'];

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      otherTenantId,
      authToken,
      vendorId,
      sellerCustomerId,
      buyerId,
      createAndReceive,
    } = await createVehicleStockSuite());
  });

  afterAll(async () => {
    await disposeVehicleStockSuite({
      app,
      basePrisma,
      prisma,
      tenantId,
      otherTenantId,
    });
  });

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
        tenant_id: tenantId,
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

    await request(app.getHttpServer())
      .patch(
        `/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}/line-items`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [],
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
        expectedLineItemsVersion: 1,
        items: [],
      })
      .expect(400);

    const restored = await prisma.vehicle.findFirst({
      where: { id: vehicleId },
    });
    expect(restored?.stock_status).toBe('IN_STOCK');

    const costs = await prisma.vehicleLedgerEntry.findMany({
      where: { vehicle_id: vehicleId, entry_type: 'WORKSHOP_COST' },
    });
    expect(costs).toHaveLength(0);

    const invoices = await prisma.invoice.count({
      where: { vehicle_id: vehicleId },
    });
    expect(invoices).toBe(0);
  });

  it('rejects receive when the posting date is fiscally locked', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/finance/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ lock_date: fiscalLockDate })
      .expect(200);

    try {
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

      const lockedResponse = await request(app.getHttpServer())
        .post(`/api/vehicle-purchases/${createRes.body.id}/receive`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(422);

      expect(lockedResponse.body.code).toBe('FISCAL_PERIOD_LOCKED');
    } finally {
      await request(app.getHttpServer())
        .patch('/api/finance/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ lock_date: null })
        .expect(200);
    }
  });

  it('rejects a cross-tenant vendor on purchase create', async () => {
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);
    const foreignVendor = await otherPrisma.vendor.create({
      data: {
        tenant_id: otherTenantId,
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
});
