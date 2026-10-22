import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenantAwarePrisma } from './tenant-test-utils.js';
import { InvoicePdfRenderer } from '../src/invoices/invoice-pdf.renderer.js';
import { InvoicePdfService } from '../src/invoices/invoice-pdf.service.js';
import { InvoicesModule } from '../src/invoices/invoices.module.js';
import { MARGIN_SCHEME_LEGAL_NOTES } from '../src/invoices/margin-scheme-legal-notes.js';
import {
  lettersAndDigits,
  normalizePdfText,
  readPdfText,
} from './pdf-text-test-utils.js';
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
  let otherAuthToken: string;
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
      otherAuthToken,
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
        tenant_id: otherTenantId,
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
      .send({ lock_date: fiscalLockDate })
      .expect(200);

    try {
      const lockedResponse = await request(app.getHttpServer())
        .post(`/api/vehicle-sales/${saleRes.body.id}/finalize`)
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

  it('AT dealer vehicle sale produces an AT-wording invoice PDF and a matching Stornorechnung', async () => {
    // AUT-349: the AT seller freezes AT wording in the snapshot; margin VAT is never printed.
    const seller = await prisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantId },
    });
    expect(seller.country_iso).toBe('AT');

    const { received } = await createAndReceive({
      vin: vin('AT-PDF'),
      sellerType: 'VENDOR',
    });
    const created = await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: received.vehicle_id,
        customer_id: buyerId,
        sale_price: 12000,
        contract_concluded_at: '2026-10-02',
        handed_over_at: '2026-10-08',
      })
      .expect(201);
    const finalized = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${created.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    const invoiceId: string = finalized.body.invoice.id;

    const committed = await prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId },
      select: { date: true, snapshot: true },
    });
    expect(committed.snapshot).toMatchObject({
      tax_mode: 'MARGIN_SCHEME',
      seller: { country_iso: 'AT' },
      margin: { calculation_profile: 'vehicle-margin-v1' },
    });

    // The archive fixture stubs the renderer for this suite; restore the real one for this render only.
    const invoicePdfService = app.select(InvoicesModule).get(InvoicePdfService);
    const invoiceRenderer = (
      invoicePdfService as unknown as { renderer: InvoicePdfRenderer }
    ).renderer;
    const stubbedRender = invoiceRenderer.render;
    invoiceRenderer.render =
      InvoicePdfRenderer.prototype.render.bind(invoiceRenderer);
    try {
      await request(app.getHttpServer())
        .post(`/api/invoices/${invoiceId}/pdf`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);
    } finally {
      invoiceRenderer.render = stubbedRender;
    }

    const invoiceText = await readRenderedPdfText(
      `/api/invoices/${invoiceId}/pdf`,
    );
    expect(lettersAndDigits(invoiceText)).toContain(
      lettersAndDigits(MARGIN_SCHEME_LEGAL_NOTES.AT),
    );
    expect(lettersAndDigits(invoiceText)).not.toContain(
      lettersAndDigits('§ 25a UStG'),
    );
    expect(lettersAndDigits(invoiceText)).toContain(
      lettersAndDigits('Brutto: 12000.00'),
    );
    expect(invoiceText).not.toContain('Umsatzsteuer');
    // Margin VAT on a 12000 sale over a 10000 cost basis at 20% is 333.33, and the cost basis is
    // 10000.00; neither is printed. The decimal point is optional because pdf.js may drop it.
    expect(invoiceText).not.toMatch(/333\.?33/);
    expect(invoiceText).not.toMatch(/10000\.?00/);

    // A credit note may not predate its invoice, and the invoice is dated when the sale is finalized,
    // so the credit date comes from the invoice rather than a fixed calendar date.
    const credit = await request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/credit-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        date: committed.date.toISOString().slice(0, 10),
        reason: 'AT Stornierung Fahrzeugverkauf',
        mode: 'FULL',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/credit-notes/${credit.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedVersion: 1,
        idempotencyKey: `at-margin-stornorechnung-${invoiceId}`,
      })
      .expect(201);

    // The Stornorechnung renders from this frozen full-document snapshot (ADR-0023).
    const stornorechnung = await prisma.creditNote.findFirstOrThrow({
      where: { id: credit.body.id },
      select: { snapshot: true },
    });
    expect(stornorechnung.snapshot).toMatchObject({
      document_kind: 'CREDIT_NOTE',
      credit_title: 'Stornorechnung',
      tax_mode: 'MARGIN_SCHEME',
      seller: { country_iso: 'AT' },
      tax_breakdown: [],
      total_tax: '0.00',
    });
  });

  async function readRenderedPdfText(path: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const { text } = await readPdfText(response.body as Buffer);
    return normalizePdfText(text);
  }
});
