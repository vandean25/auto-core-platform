import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { RksvMode } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { escapeHtml } from '../src/common/pdf/pdf-layout.js';
import { buildInvoiceHtmlDocumentForSnapshot } from '../src/invoices/invoice-pdf-localized.layout.js';
import { toRenderableInvoiceSnapshot } from '../src/invoices/invoice-snapshot-render.adapter.js';
import {
  confirmDocumentBrandTheme,
  createReadyDocumentBrandLogo,
  exerciseFrozenInvoiceArchiveLifecycle,
  withInvoiceBrandingWriterDisabled,
} from './invoice-branding-archive-test-utils.js';
import {
  createWorkshopInvoicingSuite,
  createWorkshopVehicle,
  disposeWorkshopInvoicingSuite,
} from './helpers/workshop-invoicing-suite.js';

describe('Workshop Invoicing (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;
  let legalEntityId: string;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      authToken,
      legalEntityId,
      customerId,
    } = await createWorkshopInvoicingSuite());
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { tenant_id: tenantId } });
    await disposeWorkshopInvoicingSuite({ app, basePrisma, prisma, tenantId });
  });

  beforeEach(async () => {
    vehicleId = await createWorkshopVehicle(prisma, customerId);
  });

  it.each(['default', 'confirmed'] as const)(
    'workshop origin freezes %s branding before invoice effects',
    async (profileMode) => {
      const hasConfirmedProfile = profileMode === 'confirmed';
      const api = request(app.getHttpServer());

      const orderRes = await api
        .post('/api/workshop/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          vehicleId,
          odometer: 120000,
          fuelLevel: 40,
          notes: 'Brake noise',
        })
        .expect(201);

      const orderId = orderRes.body.id;
      expect(orderRes.body.order_number).toMatch(/^WO-\d{4}-\d+$/);

      const taskRes = await api
        .post(`/api/workshop/orders/${orderId}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Replace brake pads' })
        .expect(201);

      const taskId = taskRes.body.id;

      await api
        .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          expectedLineItemsVersion: 0,
          items: [
            {
              type: 'LABOR',
              itemNo: 'LAB-001',
              description: 'Brake labor',
              qty: 2,
              unitPrice: 80,
            },
          ],
        })
        .expect(200);

      const completedRes = await api
        .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'DONE' })
        .expect(200);

      expect(completedRes.body.status).toBe('COMPLETED');

      const invoiceRes = await api
        .post('/api/invoices/drafts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ workshopOrderId: orderId })
        .expect(201);

      expect(invoiceRes.body.status).toBe('DRAFT');
      expect(invoiceRes.body.draft_number).toMatch(/^RE-D-[1-9]\d*$/);
      expect(invoiceRes.body.invoice_number).toBeNull();
      expect(invoiceRes.body.workshop_order_id).toBe(orderId);
      expect(invoiceRes.body.items).toHaveLength(1);

      const laborLine = invoiceRes.body.items.find(
        (item: any) => item.description === 'Brake labor',
      );
      expect(Number(laborLine.line_total)).toBeCloseTo(160);
      expect(Number(invoiceRes.body.total_net)).toBeCloseTo(160);
      expect(Number(invoiceRes.body.total_tax)).toBeCloseTo(32);
      expect(Number(invoiceRes.body.total_gross)).toBeCloseTo(192);

      const invoiceId = invoiceRes.body.id;
      const logo = hasConfirmedProfile
        ? await createReadyDocumentBrandLogo(
            prisma,
            tenantId,
            legalEntityId,
            `workshop-${profileMode}`,
          )
        : null;
      let expectedProfileRevision = 0;
      if (logo) {
        const confirmedTheme = await confirmDocumentBrandTheme({
          app,
          authToken,
          legalEntityId,
          logoAssetId: logo.id,
          headerText: 'Workshop profile before commitment',
        });
        expectedProfileRevision = confirmedTheme.body.activeRevision;
      }
      const invoiceSequenceBeforeDisabledCommit =
        await prisma.invoiceSequence.findFirst({
          where: { tenant_id: tenantId },
          select: { current: true },
        });
      await withInvoiceBrandingWriterDisabled(async () => {
        const disabledIssue = await api
          .patch(`/api/invoices/${invoiceId}/issue`)
          .set('Authorization', `Bearer ${authToken}`);
        expect(disabledIssue.status).toBe(503);
        expect(disabledIssue.body).toMatchObject({
          code: 'INVOICE_BRANDING_WRITER_DISABLED',
        });
      });
      const rejectedInvoice = await prisma.invoice.findFirstOrThrow({
        where: { id: invoiceId },
        select: { status: true, snapshot: true, invoice_number: true },
      });
      expect(rejectedInvoice).toMatchObject({
        status: 'DRAFT',
        snapshot: null,
        invoice_number: null,
      });
      expect(
        await prisma.workshopOrder.findFirstOrThrow({
          where: { id: orderId },
          select: { status: true },
        }),
      ).toMatchObject({ status: 'COMPLETED' });
      expect(
        await prisma.invoiceSequence.findFirst({
          where: { tenant_id: tenantId },
          select: { current: true },
        }),
      ).toEqual(invoiceSequenceBeforeDisabledCommit);
      const issueRes = await api
        .patch(`/api/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(issueRes.body.status).toBe('ISSUED');
      expect(issueRes.body.draft_number).toBe(invoiceRes.body.draft_number);
      expect(issueRes.body.invoice_number).toMatch(/^RE-\d{4}-\d{4,}$/);
      expect(issueRes.body.invoice_number).not.toBe(invoiceRes.body.draft_number);
      for (const privateField of [
        'snapshot',
        'pdf_archive_bucket',
        'pdf_archive_key',
        'pdf_archive_generation',
        'pdf_archive_sha256',
        'pdf_storage_bucket',
        'pdf_storage_key',
      ]) {
        expect(issueRes.body).not.toHaveProperty(privateField);
      }

      const committedInvoice = await prisma.invoice.findFirstOrThrow({
        where: { id: invoiceId },
        select: { snapshot: true },
      });
      const snapshot = committedInvoice.snapshot as {
        schema_version: number;
        snapshot_created_at: string;
        template_version: string;
        branding: {
          schema_version: number;
          renderer_version: string;
          resolved_at: string;
          profile_id: string | null;
          profile_revision: number;
          preset_id: string;
          logo: { asset_id: string } | null;
        };
      };
      expect(snapshot.schema_version).toBe(2);
      expect(snapshot.template_version).toBe('invoice-brand-v1');
      expect(snapshot.branding).toMatchObject({
        schema_version: 1,
        renderer_version: 'invoice-brand-v1',
      });
      expect(snapshot.branding.resolved_at).toBe(snapshot.snapshot_created_at);
      expect(snapshot.branding.preset_id).toBe('standard-v1');
      expect(snapshot.branding.logo?.asset_id ?? null).toBe(logo?.id ?? null);
      if (hasConfirmedProfile) {
        expect(snapshot.branding.profile_id).toEqual(expect.any(String));
        expect(snapshot.branding.profile_revision).toBe(
          expectedProfileRevision,
        );
      } else {
        expect(snapshot.branding.profile_id).toBeNull();
        expect(snapshot.branding.profile_revision).toBe(0);
      }

      await exerciseFrozenInvoiceArchiveLifecycle({
        app,
        prisma,
        authToken,
        invoiceId,
        legalEntityId,
        logoAssetId: logo?.id ?? null,
      });

      const publicOrder = await api
        .get(`/api/workshop/orders/${orderId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      for (const privateField of [
        'snapshot',
        'pdf_archive_bucket',
        'pdf_archive_key',
        'pdf_archive_generation',
        'pdf_archive_sha256',
        'pdf_storage_bucket',
        'pdf_storage_key',
      ]) {
        expect(publicOrder.body.invoice).not.toHaveProperty(privateField);
      }

      const lockedOrder = await prisma.workshopOrder.findFirst({
        where: { id: orderId },
      });
      expect(lockedOrder?.status).toBe('INVOICED');

      await api
        .patch(`/api/workshop/orders/${orderId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ notes: 'Attempt to edit after invoicing' })
        .expect(400);
    },
  );

  async function issueMultiLineDecimalWorkshopInvoice(): Promise<string> {
    const api = request(app.getHttpServer());
    const orderRes = await api
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 120000,
        fuelLevel: 40,
        notes: 'Multi-line decimal invoice',
      })
      .expect(201);

    const taskRes = await api
      .post(`/api/workshop/orders/${orderRes.body.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Decimal qty + unit lines' })
      .expect(201);

    await api
      .patch(
        `/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}/line-items`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-DEC',
            description: 'Diagnostic labor',
            qty: 1.5,
            unitPrice: 12.99,
          },
          {
            type: 'LABOR',
            itemNo: 'LAB-U1',
            description: 'Small job 1',
            qty: 1,
            unitPrice: 10.03,
          },
          {
            type: 'LABOR',
            itemNo: 'LAB-U2',
            description: 'Small job 2',
            qty: 1,
            unitPrice: 10.03,
          },
        ],
      })
      .expect(200);

    await api
      .patch(`/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    const draftRes = await api
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderRes.body.id })
      .expect(201);

    await api
      .patch(`/api/invoices/${draftRes.body.id}/issue`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    return draftRes.body.id as string;
  }

  it('Scenario 4: issued multi-line workshop invoice with decimal quantity has stored == snapshot == PDF totals', async () => {
    const invoiceId = await issueMultiLineDecimalWorkshopInvoice();
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId, tenant_id: tenantId },
    });
    const snapshot = invoice.snapshot as {
      total_net: string;
      total_tax: string;
      total_gross: string;
    };

    expect(invoice.total_net.toFixed(2)).toBe('39.55');
    expect(invoice.total_tax.toFixed(2)).toBe('7.91');
    expect(invoice.total_gross.toFixed(2)).toBe('47.46');
    expect(snapshot.total_net).toBe('39.55');
    expect(snapshot.total_tax).toBe('7.91');
    expect(snapshot.total_gross).toBe('47.46');

    const renderable = toRenderableInvoiceSnapshot(
      invoice.snapshot,
      invoice.invoice_number ?? 'RE-TEST',
      invoice.id,
    );
    if (!renderable) {
      throw new Error('Expected renderable invoice snapshot');
    }
    const formatDate = (value: string | Date) =>
      new Date(value).toLocaleDateString('de-DE');
    const pdfHtml = buildInvoiceHtmlDocumentForSnapshot(
      renderable,
      invoice.invoice_number ?? 'RE-TEST',
      escapeHtml,
      formatDate,
      null,
    );
    expect(pdfHtml).toContain('39,55');
    expect(pdfHtml).toContain('7,91');
    expect(pdfHtml).toContain('47,46');
  });

  it('Scenario 5: settling issued multi-line decimal workshop invoice succeeds without 422 SETTLEMENT_AMOUNT_MISMATCH and payment == snapshot gross', async () => {
    await prisma.legalEntity.updateMany({
      where: { id: legalEntityId, tenant_id: tenantId },
      data: { rksv_mode: RksvMode.REQUIRED_EXTERNAL_KASSE },
    });

    const invoiceId = await issueMultiLineDecimalWorkshopInvoice();
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId, tenant_id: tenantId },
    });
    const snapshot = invoice.snapshot as { total_gross: string };

    const settleRes = await request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        idempotencyKey: randomUUID(),
        method: 'CASH',
        externalReceiptNumber: 'EXT-REC-001',
        externalReceiptDate: '2026-11-14T12:00:00.000Z',
      })
      .expect(201);

    expect(settleRes.body.payment.amount).toBe(snapshot.total_gross);
    expect(settleRes.body.invoiceStatus).toBe('PAID');
  });

  it('Scenario 7: workshop draft -> PATCH discounts (line PERCENTAGE + FLAT_AMOUNT + global) -> issue -> stored == snapshot == PDF totals -> settlement succeeds', async () => {
    await prisma.legalEntity.updateMany({
      where: { id: legalEntityId, tenant_id: tenantId },
      data: { rksv_mode: RksvMode.REQUIRED_EXTERNAL_KASSE },
    });

    const api = request(app.getHttpServer());
    const orderRes = await api
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 125000,
        fuelLevel: 50,
        notes: 'Discounted brake service',
      })
      .expect(201);

    const taskRes = await api
      .post(`/api/workshop/orders/${orderRes.body.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Brake service' })
      .expect(201);

    await api
      .patch(
        `/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}/line-items`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-DISC-1',
            description: 'Brake labor',
            qty: 2,
            unitPrice: 100,
          },
          {
            type: 'PART',
            itemNo: 'PART-DISC-1',
            description: 'Brake pads',
            qty: 1,
            unitPrice: 100,
          },
        ],
      })
      .expect(200);

    await api
      .patch(`/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    const draftRes = await api
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderRes.body.id })
      .expect(201);

    const draftItems = draftRes.body.items as Array<{
      id: string;
      description: string;
    }>;
    const laborLine = draftItems.find((i) => i.description === 'Brake labor')!;
    const partLine = draftItems.find((i) => i.description === 'Brake pads')!;

    // 200 - 10% = 180; 100 - 20 = 80; subtotal = 260; global 10% = 26 -> net 234, tax 46.80, gross 280.80
    const discountRes = await api
      .patch(`/api/invoices/${draftRes.body.id}/discounts`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        globalDiscountType: 'PERCENTAGE',
        globalDiscountValue: 10,
        lineItems: [
          {
            id: laborLine.id,
            discountType: 'PERCENTAGE',
            discountValue: 10,
          },
          {
            id: partLine.id,
            discountType: 'FLAT_AMOUNT',
            discountValue: 20,
          },
        ],
      })
      .expect(200);

    expect(Number(discountRes.body.total_net)).toBe(234);
    expect(Number(discountRes.body.total_tax)).toBe(46.8);
    expect(Number(discountRes.body.total_gross)).toBe(280.8);

    await api
      .patch(`/api/invoices/${draftRes.body.id}/issue`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { id: draftRes.body.id, tenant_id: tenantId },
    });
    const snapshot = invoice.snapshot as {
      total_net: string;
      total_tax: string;
      total_gross: string;
      items: Array<{
        line_discount_type: string | null;
        line_discount_value: string | null;
      }>;
    };

    expect(invoice.total_net.toFixed(2)).toBe('234.00');
    expect(invoice.total_tax.toFixed(2)).toBe('46.80');
    expect(invoice.total_gross.toFixed(2)).toBe('280.80');
    expect(snapshot.total_net).toBe('234.00');
    expect(snapshot.total_tax).toBe('46.80');
    expect(snapshot.total_gross).toBe('280.80');
    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line_discount_type: 'PERCENTAGE',
          line_discount_value: '10.00',
        }),
        expect.objectContaining({
          line_discount_type: 'FLAT_AMOUNT',
          line_discount_value: '20.00',
        }),
      ]),
    );

    const renderable = toRenderableInvoiceSnapshot(
      invoice.snapshot,
      invoice.invoice_number ?? 'RE-TEST',
      invoice.id,
    );
    if (!renderable) {
      throw new Error('Expected renderable invoice snapshot');
    }
    const formatDate = (value: string | Date) =>
      new Date(value).toLocaleDateString('de-DE');
    const pdfHtml = buildInvoiceHtmlDocumentForSnapshot(
      renderable,
      invoice.invoice_number ?? 'RE-TEST',
      escapeHtml,
      formatDate,
      null,
    );
    expect(pdfHtml).toContain('234,00');
    expect(pdfHtml).toContain('46,80');
    expect(pdfHtml).toContain('280,80');

    const settleRes = await api
      .post(`/api/invoices/${draftRes.body.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        idempotencyKey: randomUUID(),
        method: 'CASH',
        externalReceiptNumber: 'EXT-REC-DISC-001',
        externalReceiptDate: '2026-11-14T12:00:00.000Z',
      })
      .expect(201);

    expect(settleRes.body.payment.amount).toBe('280.80');
    expect(settleRes.body.invoiceStatus).toBe('PAID');
  });
});
