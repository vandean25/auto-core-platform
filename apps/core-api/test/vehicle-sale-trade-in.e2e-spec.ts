import { AuthService } from '../src/auth/auth.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  installFakeInvoiceArchiveStorage,
} from './invoice-branding-archive-test-utils.js';

const TRADE_IN_VIN = 'TRDNB000000000001';

function soldVin(tag: string) {
  return `WVWSALE${tag.padStart(10, '0').slice(-10)}`;
}

describe('Vehicle sale trade-in (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let otherAuthToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let vendorId: string;
  let buyerId: string;
  let otherBuyerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    installFakeInvoiceArchiveStorage(app);

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'vehicle-trade-in');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    const otherTenant = await createTestTenant(
      basePrisma,
      'vehicle-trade-in-b',
    );
    otherTenantId = otherTenant.tenantId;
    otherAuthToken = createTestAuthToken(app.get(AuthService), otherTenant);

    const vendor = await prisma.vendor.create({
      data: {
        name: 'Demo Vehicle Vendor',
        email: 'vendor-trade-in@test.invalid',
        account_number: 'VC-TRADE-IN',
      },
    });
    vendorId = vendor.id;

    const buyer = await prisma.customer.create({
      data: {
        first_name: 'Demo',
        last_name: 'Buyer',
        email: 'buyer-trade-in@test.invalid',
        type: 'PRIVATE',
        address_street: 'Musterweg 1',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
      },
    });
    buyerId = buyer.id;

    const otherBuyer = await prisma.customer.create({
      data: {
        first_name: 'Other',
        last_name: 'Buyer',
        email: 'other-buyer-trade-in@test.invalid',
        type: 'PRIVATE',
        address_street: 'Musterweg 2',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
      },
    });
    otherBuyerId = otherBuyer.id;

    await seedReadySellerAndAccountingProfile(prisma, tenantId, {
      includeVehicleMargin: true,
    });
  });

  afterAll(async () => {
    if (tenantId) {
      await basePrisma.$executeRawUnsafe(
        'DELETE FROM "invoice_brand_asset_references" WHERE "tenant_id" = $1',
        tenantId,
      );
      await prisma.documentBrandProfile.deleteMany();
      await prisma.documentBrandAsset.deleteMany();
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    if (otherTenantId) {
      await cleanupTestTenantGraph(basePrisma, otherTenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  async function receiveStockVehicle(vin: string, price: number) {
    const created = await request(app.getHttpServer())
      .post('/api/vehicle-purchases')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        seller_type: 'VENDOR',
        vendor_id: vendorId,
        vin,
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
        purchase_price: price,
      })
      .expect(201);
    const received = await request(app.getHttpServer())
      .post(`/api/vehicle-purchases/${created.body.id}/receive`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    return received.body.vehicle_id as string;
  }

  async function createDraftSale(vehicleId: string, salePrice: number) {
    const res = await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: vehicleId,
        customer_id: buyerId,
        sale_price: salePrice,
      })
      .expect(201);
    return res.body.id as string;
  }

  function putTradeIn(saleId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put(`/api/vehicle-sales/${saleId}/trade-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vin: TRADE_IN_VIN,
        make: 'Skoda',
        model: 'Octavia',
        year: 2016,
        mileage: 98000,
        first_registration_date: '2016-03-01',
        ...body,
      });
  }

  it('nets the trade-in allowance onto a finalized margin invoice and audits it', async () => {
    const vehicleId = await receiveStockVehicle(soldVin('0001'), 10000);
    const saleId = await createDraftSale(vehicleId, 20000);

    const set = await putTradeIn(saleId, { allowance: 15000 }).expect(200);
    expect(set.body.trade_in_purchase).toMatchObject({
      vin: TRADE_IN_VIN,
      status: 'DRAFT',
      acquisition_kind: 'TRADE_IN',
      seller_type: 'CUSTOMER',
      customer_id: buyerId,
      year: 2016,
      mileage: 98000,
    });
    expect(Number(set.body.amount_due_preview)).toBe(5000);

    const finalized = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    const invoiceId = finalized.body.invoice.id as string;

    // Cash billed after the allowance; margin VAT stays on the full sale price (20000 - 10000 cost).
    expect(Number(finalized.body.invoice.total_gross)).toBe(5000);
    expect(Number(finalized.body.invoice.total_tax)).toBeCloseTo(1666.67, 2);
    expect(Number(finalized.body.invoice.total_net)).toBeCloseTo(18333.33, 2);

    const items = await prisma.invoiceItem.findMany({
      where: { invoice_id: invoiceId },
    });
    expect(items).toHaveLength(2);
    const vehicleLine = items.find((item) => item.line_total?.gt(0));
    const tradeInLine = items.find((item) => item.line_total?.lt(0));
    expect(vehicleLine?.line_total?.toFixed(2)).toBe('20000.00');
    expect(tradeInLine?.line_total?.toFixed(2)).toBe('-15000.00');
    expect(tradeInLine?.description).toBe(
      `Trade-in 2016 Skoda Octavia VIN ${TRADE_IN_VIN}`,
    );
    expect(
      items.every((item) => item.revenue_group_name === 'Vehicle used (margin)'),
    ).toBe(true);

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId },
      select: { snapshot: true, tax_mode: true, total_gross: true },
    });
    const snapshot = invoice.snapshot as {
      total_gross: string;
      items: Array<{ net: string; gross: string }>;
    };
    expect(invoice.tax_mode).toBe('MARGIN_SCHEME');
    expect(snapshot.total_gross).toBe('5000.00');
    expect(snapshot.items.map((item) => item.net).sort()).toEqual([
      '-15000.00',
      '20000.00',
    ]);

    const audits = await prisma.auditLog.findMany({
      where: { entity_type: 'VehicleSale', entity_id: saleId },
    });
    const nettingAudit = audits.find(
      (row) => (row.after as { invoice_id?: string } | null)?.invoice_id === invoiceId,
    );
    expect(nettingAudit).toBeDefined();
    expect(nettingAudit?.after).toMatchObject({
      trade_in_allowance: '15000.00',
      amount_due: '5000.00',
      invoice_number: finalized.body.invoice.invoice_number,
    });
    expect(audits.some((row) => (row.after as { trade_in_purchase_id?: string } | null)?.trade_in_purchase_id === set.body.trade_in_purchase.id)).toBe(true);
  });

  it('rejects a zero, negative, over-price or malformed trade-in', async () => {
    const vehicleId = await receiveStockVehicle(soldVin('0002'), 10000);
    const saleId = await createDraftSale(vehicleId, 20000);

    await putTradeIn(saleId, { allowance: 0 }).expect(400);
    await putTradeIn(saleId, { allowance: -100 }).expect(400);
    await putTradeIn(saleId, { allowance: 15000.001 }).expect(400);
    await putTradeIn(saleId, { vin: 'SHORT' }).expect(400);
    await putTradeIn(saleId, { vin: 'TRDNB00000000000I' }).expect(400);

    const overPrice = await putTradeIn(saleId, { allowance: 25000 }).expect(422);
    expect(overPrice.body.code).toBe('TRADE_IN_ALLOWANCE_INVALID');

    const sameCar = await putTradeIn(saleId, {
      allowance: 1000,
      vin: soldVin('0002'),
    }).expect(422);
    expect(sameCar.body.code).toBe('TRADE_IN_VIN_IS_SOLD_VEHICLE');

    const sale = await request(app.getHttpServer())
      .get(`/api/vehicle-sales/${saleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(sale.body.trade_in_purchase).toBeNull();
  });

  it('keeps the trade-in purchase owned by its sale: no cancel, edit, or delete outside it', async () => {
    const vehicleId = await receiveStockVehicle(soldVin('0003'), 10000);
    const saleId = await createDraftSale(vehicleId, 20000);
    const set = await putTradeIn(saleId, { allowance: 15000 }).expect(200);
    const tradeInId = set.body.trade_in_purchase.id as string;

    await request(app.getHttpServer())
      .post(`/api/vehicle-purchases/${tradeInId}/cancel`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/vehicle-purchases/${tradeInId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ purchase_price: 1 })
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/api/vehicle-purchases/${tradeInId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);

    const stock = await request(app.getHttpServer())
      .get('/api/vehicle-stock')
      .query({ search: TRADE_IN_VIN })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(
      stock.body.data.some(
        (row: { draft_purchase_id?: string }) => row.draft_purchase_id === tradeInId,
      ),
    ).toBe(false);
  });

  it('removes a draft trade-in from the sale and deletes its draft purchase', async () => {
    const vehicleId = await receiveStockVehicle(soldVin('0004'), 10000);
    const saleId = await createDraftSale(vehicleId, 20000);
    const set = await putTradeIn(saleId, { allowance: 15000 }).expect(200);
    const tradeInId = set.body.trade_in_purchase.id as string;

    const removed = await request(app.getHttpServer())
      .delete(`/api/vehicle-sales/${saleId}/trade-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(removed.body.trade_in_purchase).toBeNull();
    expect(removed.body.amount_due_preview).toBe('20000');

    await request(app.getHttpServer())
      .get(`/api/vehicle-purchases/${tradeInId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });

  it('refuses a buyer change and a sale price below the allowance while a trade-in is attached', async () => {
    const vehicleId = await receiveStockVehicle(soldVin('0005'), 10000);
    const saleId = await createDraftSale(vehicleId, 20000);
    await putTradeIn(saleId, { allowance: 15000 }).expect(200);

    await request(app.getHttpServer())
      .patch(`/api/vehicle-sales/${saleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ customer_id: otherBuyerId })
      .expect(422);

    const lowered = await request(app.getHttpServer())
      .patch(`/api/vehicle-sales/${saleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ sale_price: 10000 })
      .expect(422);
    expect(lowered.body.code).toBe('TRADE_IN_ALLOWANCE_INVALID');
  });

  it('blocks credit notes on a trade-in invoice instead of silently dropping the trade-in line', async () => {
    const vehicleId = await receiveStockVehicle(soldVin('0006'), 10000);
    const saleId = await createDraftSale(vehicleId, 20000);
    await putTradeIn(saleId, { allowance: 15000 }).expect(200);
    const finalized = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${saleId}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const credit = await request(app.getHttpServer())
      .post(`/api/invoices/${finalized.body.invoice.id}/credit-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        date: new Date().toISOString().slice(0, 10),
        reason: 'Customer return',
        mode: 'FULL',
      })
      .expect(422);
    expect(credit.body.code).toBe('NEGATIVE_LINE_CREDIT_UNSUPPORTED');
  });

  it('hides another tenant\'s sale from the trade-in endpoints', async () => {
    const vehicleId = await receiveStockVehicle(soldVin('0007'), 10000);
    const saleId = await createDraftSale(vehicleId, 20000);

    await request(app.getHttpServer())
      .put(`/api/vehicle-sales/${saleId}/trade-in`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .send({
        allowance: 1000,
        vin: TRADE_IN_VIN,
        make: 'Skoda',
        model: 'Octavia',
        year: 2016,
      })
      .expect(404);
  });
});
