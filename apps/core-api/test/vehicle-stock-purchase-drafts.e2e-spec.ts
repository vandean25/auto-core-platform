import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
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
  let otherAuthToken: string;
  let vendorId: string;
  let createAndReceive: VehicleStockSuite['createAndReceive'];

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      otherTenantId,
      authToken,
      otherAuthToken,
      vendorId,
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

  it('lists draft purchases as ON_ORDER rows on the stock list', async () => {
    const draftVin = vin('DRAFT1');
    const createRes = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: draftVin,
        make: 'Volkswagen',
        model: 'Passat',
        year: 2016,
        purchase_price: 8000,
      })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/api/vehicle-stock')
      .query({ search: draftVin })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const row = listRes.body.data.find(
      (item: { vin: string }) => item.vin === draftVin,
    );
    expect(row).toMatchObject({
      id: createRes.body.id,
      draft_purchase_id: createRes.body.id,
      stock_status: 'ON_ORDER',
      make: 'Volkswagen',
      model: 'Passat',
      year: 2016,
    });
  });

  it('deletes a DRAFT purchase and refuses delete after receive', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: vin('DEL01'),
        make: 'Volkswagen',
        model: 'Polo',
        year: 2015,
        purchase_price: 5000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/vehicle-purchases/${createRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/vehicle-purchases/${createRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    const { purchase } = await createAndReceive({
      vin: vin('DEL02'),
      sellerType: 'VENDOR',
    });

    await request(app.getHttpServer())
      .delete(`/api/vehicle-purchases/${purchase.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .get(`/api/vehicle-purchases/${purchase.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('hides another tenant draft from the stock list and from delete', async () => {
    const draftVin = vin('XTENA');
    const createRes = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: draftVin,
        make: 'Volkswagen',
        model: 'Tiguan',
        year: 2017,
        purchase_price: 9000,
      })
      .expect(201);

    const foreignList = await request(app.getHttpServer())
      .get('/api/vehicle-stock')
      .query({ search: draftVin })
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(200);

    expect(
      foreignList.body.data.filter(
        (item: { vin: string }) => item.vin === draftVin,
      ),
    ).toEqual([]);

    await request(app.getHttpServer())
      .delete(`/api/vehicle-purchases/${createRes.body.id}`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/vehicle-purchases/${createRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('paginates draft purchases ahead of received vehicles', async () => {
    const make = 'PagMix';
    const firstDraft = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: vin('PGMX1'),
        make,
        model: 'DraftOne',
        year: 2014,
        purchase_price: 4000,
      })
      .expect(201);
    const secondDraft = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: vin('PGMX2'),
        make,
        model: 'DraftTwo',
        year: 2014,
        purchase_price: 4000,
      })
      .expect(201);
    const received = await createAndReceive({
      vin: vin('PGMX3'),
      sellerType: 'VENDOR',
    });
    await prisma.vehicle.update({
      where: { id: received.received.vehicle_id },
      data: { make, model: 'Received' },
    });

    const page1 = await request(app.getHttpServer())
      .get('/api/vehicle-stock')
      .query({ search: make, limit: '1', page: '1' })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const page2 = await request(app.getHttpServer())
      .get('/api/vehicle-stock')
      .query({ search: make, limit: '1', page: '2' })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const page3 = await request(app.getHttpServer())
      .get('/api/vehicle-stock')
      .query({ search: make, limit: '1', page: '3' })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(page1.body.meta.total).toBe(3);
    expect(page1.body.data).toHaveLength(1);
    expect(page2.body.data).toHaveLength(1);
    expect(page3.body.data).toHaveLength(1);

    const ids = [
      page1.body.data[0].id,
      page2.body.data[0].id,
      page3.body.data[0].id,
    ];
    expect(new Set(ids).size).toBe(3);
    expect([firstDraft.body.id, secondDraft.body.id]).toEqual(
      expect.arrayContaining([page1.body.data[0].id, page2.body.data[0].id]),
    );
    expect(page1.body.data[0].draft_purchase_id).toBeTruthy();
    expect(page2.body.data[0].draft_purchase_id).toBeTruthy();
    expect(page3.body.data[0]).toMatchObject({
      id: received.received.vehicle_id,
      draft_purchase_id: null,
    });
  });

  it('refuses to delete a DRAFT purchase that already has ledger entries', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin: vin('LEDGR1'),
        make: 'Volkswagen',
        model: 'Caddy',
        year: 2013,
        purchase_price: 3500,
      })
      .expect(201);

    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Volkswagen',
        model: 'Caddy',
        year: 2013,
        vin: vin('LEDGRV'),
        inventory_role: 'CUSTOMER',
      },
    });
    await prisma.vehicleLedgerEntry.create({
      data: {
        tenant_id: tenantId,
        vehicle_id: vehicle.id,
        entry_type: 'PURCHASE',
        amount: 3500,
        posting_date: new Date(),
        vehicle_purchase_id: createRes.body.id,
      },
    });

    await request(app.getHttpServer())
      .delete(`/api/vehicle-purchases/${createRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .get(`/api/vehicle-purchases/${createRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });
});
