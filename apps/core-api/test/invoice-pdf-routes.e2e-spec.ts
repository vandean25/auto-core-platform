import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { signPdfTaskPayload } from '../src/common/index.js';
import { CreditNotePdfService } from '../src/credit-notes/credit-note-pdf.service.js';
import { InvoicePdfService } from '../src/invoices/invoice-pdf.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  bootstrapE2eApp,
  createE2eTenant,
  deleteDocumentBrandRows,
} from './helpers/e2e-suite.js';
import { seedLegacyInvoicePdf } from './invoice-branding-archive-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';

const WORKER_SECRET = 'invoice-pdf-routes-e2e-worker-secret';
const FINALIZED_INVOICE_ID = '22222222-2222-4222-a222-222222222222';
const MISSING_INVOICE_ID = '00000000-0000-4000-8000-000000000000';

async function createIssuedInvoiceWithCachedPdf(
  app: INestApplication,
  prisma: PrismaService,
  tenantId: string,
): Promise<string> {
  await seedReadySellerAndAccountingProfile(prisma, tenantId);
  const customer = await seedInvoiceReadyCustomer(prisma, tenantId);
  const siteId = await resolveTestMainSiteId(prisma, tenantId);
  const legalEntity = await prisma.legalEntity.findFirstOrThrow({
    where: { tenant_id: tenantId },
    select: { id: true },
  });
  const snapshotCreatedAt = '2026-10-16T00:00:00.000Z';
  const snapshot = {
    schema_version: 2,
    document_kind: 'INVOICE',
    template_version: 'invoice-pdf-v1',
    site_id: siteId,
    legal_entity_id: legalEntity.id,
    currency: 'EUR',
    date: '2026-10-16',
    due_date: '2026-10-30',
    notes: null,
    tax_mode: 'STANDARD',
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    customer: {
      id: customer.id,
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Max',
      last_name: 'Mustermann',
      email: 'max@example.com',
      phone: null,
      vat_id: null,
      address_street: 'Kundenstraße 2',
      address_city: 'Wien',
      address_zip: '1020',
      address_country: 'AT',
    },
    vehicle: null,
    items: [
      {
        description: 'Pilot customer line item',
        quantity: '1.00',
        unit_price: '100.00',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '120.00',
        revenue_group_name: null,
      },
    ],
    snapshot_created_at: snapshotCreatedAt,
    seller: { name: 'Pilot Seller' },
    tax_breakdown: [],
  };

  const pdfBucket =
    process.env.INVOICE_PDF_BUCKET?.trim() || 'test-invoice-pdf';
  const pdfKey = `invoices/e2e-pdf-${Date.now()}.pdf`;
  const invoice = await prisma.invoice.create({
    data: {
      tenant_id: tenantId,
      site_id: siteId,
      legal_entity_id: legalEntity.id,
      customer_id: customer.id,
      status: 'ISSUED',
      invoice_number: `RE-PDF-${Date.now()}`,
      date: new Date('2026-10-16'),
      due_date: new Date('2026-10-30'),
      total_net: 100,
      total_tax: 20,
      total_gross: 120,
      snapshot,
      pdf_storage_bucket: pdfBucket,
      pdf_storage_key: pdfKey,
      pdf_generated_at: new Date('2026-10-16T00:00:00.000Z'),
    },
    select: { id: true },
  });
  seedLegacyInvoicePdf(app, pdfBucket, pdfKey, Buffer.from('%PDF-1.4 e2e'));
  return invoice.id;
}

describe('Invoice PDF routes (e2e)', () => {
  describe('validation, auth, and worker guards', () => {
    let app: INestApplication;
    let authToken: string;
    let prisma: PrismaService;
    let tenantId: string;

    const mockInvoicePdfService = {
      requestGeneration: jest.fn(),
      getPdf: jest.fn(),
      generateNow: jest.fn(),
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      process.env.CLOUD_TASKS_WORKER_SECRET = WORKER_SECRET;

      app = await createE2eApp((builder) =>
        builder
          .overrideProvider(InvoicePdfService)
          .useValue(mockInvoicePdfService),
      );

      prisma = app.get(PrismaService);
      const testTenant = await createTestTenant(prisma, 'invoice-pdf-routes');
      tenantId = testTenant.tenantId;
      authToken = createTestAuthToken(app.get(AuthService), testTenant);
    });

    afterEach(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

    const auth = () => ({ Authorization: `Bearer ${authToken}` });

    function signedInvoiceTask(resourceId: string) {
      return signPdfTaskPayload(
        { kind: 'invoice', resourceId, tenantId },
        WORKER_SECRET,
      );
    }

    it('returns 401 for POST and GET /api/invoices/:id/pdf without auth', async () => {
      await request(app.getHttpServer())
        .post(`/api/invoices/${FINALIZED_INVOICE_ID}/pdf`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/api/invoices/${FINALIZED_INVOICE_ID}/pdf`)
        .expect(401);
    });

    it('returns 400 for non-UUID invoice ids on PDF routes', async () => {
      const invalidIds = ['notauuid', '../../etc'];

      for (const invalidId of invalidIds) {
        const segment = encodeURIComponent(invalidId);
        await request(app.getHttpServer())
          .post(`/api/invoices/${segment}/pdf`)
          .set(auth())
          .expect(400);
        await request(app.getHttpServer())
          .get(`/api/invoices/${segment}/pdf`)
          .set(auth())
          .expect(400);
        await request(app.getHttpServer())
          .post(`/api/invoices/${segment}/pdf/worker`)
          .set('x-cloud-tasks-secret', WORKER_SECRET)
          .set('x-tenant-id', tenantId)
          .send(signedInvoiceTask(invalidId))
          .expect(400);
      }
    });

    it('rejects the PDF worker without a valid Cloud Tasks worker secret', async () => {
      const payload = signedInvoiceTask(FINALIZED_INVOICE_ID);
      const rendersBefore = mockInvoicePdfService.generateNow.mock.calls.length;

      await request(app.getHttpServer())
        .post(`/api/invoices/${FINALIZED_INVOICE_ID}/pdf/worker`)
        .send(payload)
        .expect(401);
      await request(app.getHttpServer())
        .post(`/api/invoices/${FINALIZED_INVOICE_ID}/pdf/worker`)
        .set('x-cloud-tasks-secret', 'not-the-secret')
        .send(payload)
        .expect(401);

      expect(mockInvoicePdfService.generateNow.mock.calls.length).toBe(
        rendersBefore,
      );
    });

    it('accepts the PDF worker when the signed payload matches the route id', async () => {
      mockInvoicePdfService.generateNow.mockResolvedValue(undefined);
      const payload = signedInvoiceTask(FINALIZED_INVOICE_ID);

      await request(app.getHttpServer())
        .post(`/api/invoices/${FINALIZED_INVOICE_ID}/pdf/worker`)
        .set('x-cloud-tasks-secret', WORKER_SECRET)
        .set('x-tenant-id', tenantId)
        .send(payload)
        .expect(204);

      expect(mockInvoicePdfService.generateNow).toHaveBeenCalledWith(
        FINALIZED_INVOICE_ID,
      );
    });

    it('returns 400 for a non-UUID id on PATCH /api/invoices/:id/issue', async () => {
      await request(app.getHttpServer())
        .patch('/api/invoices/notauuid/issue')
        .set(auth())
        .expect(400);
    });
  });

  describe('invoice PDF service integration', () => {
    let app: INestApplication;
    let basePrisma: PrismaService;
    let prisma: PrismaService;
    let authToken: string;
    let tenantId: string;

    beforeEach(async () => {
      process.env.CLOUD_TASKS_WORKER_SECRET = WORKER_SECRET;
      const boot = await bootstrapE2eApp();
      app = boot.app;
      basePrisma = boot.basePrisma;
      const tenant = await createE2eTenant(
        app,
        basePrisma,
        'invoice-pdf-integration',
      );
      tenantId = tenant.tenantId;
      prisma = tenant.prisma;
      authToken = tenant.authToken;
    });

    afterEach(async () => {
      if (tenantId) {
        await deleteDocumentBrandRows(basePrisma, prisma);
        await cleanupTestTenantGraph(basePrisma, tenantId);
        tenantId = '';
      }
      await teardownTestApp(app, basePrisma);
    });

    const auth = () => ({ Authorization: `Bearer ${authToken}` });

    it('returns 404 when the invoice id is a valid UUID but does not exist', async () => {
      const pdfService = app.get(InvoicePdfService);
      const requestSpy = jest.spyOn(pdfService, 'requestGeneration');
      const getSpy = jest.spyOn(pdfService, 'getPdf');

      await request(app.getHttpServer())
        .post(`/api/invoices/${MISSING_INVOICE_ID}/pdf`)
        .set(auth())
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/invoices/${MISSING_INVOICE_ID}/pdf`)
        .set(auth())
        .expect(404);

      expect(requestSpy).toHaveBeenCalledWith(
        MISSING_INVOICE_ID,
        expect.objectContaining({ targetBaseUrl: expect.any(String) }),
      );
      expect(getSpy).toHaveBeenCalledWith(MISSING_INVOICE_ID);

      requestSpy.mockRestore();
      getSpy.mockRestore();
    });

    it('runs requestGeneration and streams a PDF for a finalized invoice', async () => {
      const invoiceId = await createIssuedInvoiceWithCachedPdf(
        app,
        prisma,
        tenantId,
      );
      const pdfService = app.get(InvoicePdfService);
      const requestSpy = jest.spyOn(pdfService, 'requestGeneration');
      const getSpy = jest.spyOn(pdfService, 'getPdf');

      const generated = await request(app.getHttpServer())
        .post(`/api/invoices/${invoiceId}/pdf`)
        .set(auth())
        .expect(201);

      expect(requestSpy).toHaveBeenCalledWith(
        invoiceId,
        expect.objectContaining({ targetBaseUrl: expect.any(String) }),
      );
      expect(generated.body).toMatchObject({
        mode: 'cached',
        invoiceId,
      });

      await request(app.getHttpServer())
        .get(`/api/invoices/${invoiceId}/pdf`)
        .set(auth())
        .expect(200)
        .expect('Content-Type', /application\/pdf/);
      expect(getSpy).toHaveBeenCalledWith(invoiceId);

      requestSpy.mockRestore();
      getSpy.mockRestore();
    });
  });
});

describe('Credit note PDF routes (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  let tenantId: string;

  const mockCreditNotePdfService = {
    requestGeneration: jest.fn(),
    getPdf: jest.fn(),
    generateNow: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.CLOUD_TASKS_WORKER_SECRET = WORKER_SECRET;

    app = await createE2eApp((builder) =>
      builder
        .overrideProvider(CreditNotePdfService)
        .useValue(mockCreditNotePdfService),
    );

    prisma = app.get(PrismaService);
    const testTenant = await createTestTenant(prisma, 'credit-note-pdf-routes');
    tenantId = testTenant.tenantId;
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
  });

  afterEach(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  const auth = () => ({ Authorization: `Bearer ${authToken}` });

  function signedCreditNoteTask(resourceId: string) {
    return signPdfTaskPayload(
      { kind: 'credit-note', resourceId, tenantId },
      WORKER_SECRET,
    );
  }

  it('returns 401 for POST and GET /api/credit-notes/:id/pdf without auth', async () => {
    const creditNoteId = '33333333-3333-4333-a333-333333333333';
    await request(app.getHttpServer())
      .post(`/api/credit-notes/${creditNoteId}/pdf`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/credit-notes/${creditNoteId}/pdf`)
      .expect(401);
  });

  it('returns 400 for non-UUID credit note ids on PDF routes', async () => {
    const invalidIds = ['notauuid', '../../etc'];

    for (const invalidId of invalidIds) {
      const segment = encodeURIComponent(invalidId);
      await request(app.getHttpServer())
        .post(`/api/credit-notes/${segment}/pdf`)
        .set(auth())
        .expect(400);
      await request(app.getHttpServer())
        .get(`/api/credit-notes/${segment}/pdf`)
        .set(auth())
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/credit-notes/${segment}/pdf/worker`)
        .set('x-cloud-tasks-secret', WORKER_SECRET)
        .set('x-tenant-id', tenantId)
        .send(signedCreditNoteTask(invalidId))
        .expect(400);
    }

    expect(mockCreditNotePdfService.requestGeneration).not.toHaveBeenCalled();
    expect(mockCreditNotePdfService.getPdf).not.toHaveBeenCalled();
    expect(mockCreditNotePdfService.generateNow).not.toHaveBeenCalled();
  });
});
