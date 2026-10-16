import { Readable } from 'node:stream';
import {
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  createGlobalValidationPipe,
  signPdfTaskPayload,
} from '../src/common/index.js';
import { InvoicePdfService } from '../src/invoices/invoice-pdf.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';

const WORKER_SECRET = 'invoice-pdf-routes-e2e-worker-secret';
const FINALIZED_INVOICE_ID = '22222222-2222-4222-a222-222222222222';
const MISSING_INVOICE_ID = '00000000-0000-4000-8000-000000000000';

describe('Invoice PDF routes (e2e)', () => {
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

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InvoicePdfService)
      .useValue(mockInvoicePdfService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

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

  it('returns 404 when the invoice id is a valid UUID but does not exist', async () => {
    mockInvoicePdfService.requestGeneration.mockRejectedValue(
      new NotFoundException('Invoice not found'),
    );
    mockInvoicePdfService.getPdf.mockRejectedValue(
      new NotFoundException('Invoice not found'),
    );

    await request(app.getHttpServer())
      .post(`/api/invoices/${MISSING_INVOICE_ID}/pdf`)
      .set(auth())
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/invoices/${MISSING_INVOICE_ID}/pdf`)
      .set(auth())
      .expect(404);
  });

  it('returns generated or enqueued JSON for a finalized invoice PDF request', async () => {
    mockInvoicePdfService.requestGeneration.mockResolvedValueOnce({
      mode: 'generated',
      invoiceId: FINALIZED_INVOICE_ID,
      bucket: 'invoice-pdf-bucket',
      key: `invoices/${FINALIZED_INVOICE_ID}.pdf`,
      generatedAt: new Date('2026-10-16T00:00:00.000Z'),
    });

    const generated = await request(app.getHttpServer())
      .post(`/api/invoices/${FINALIZED_INVOICE_ID}/pdf`)
      .set(auth())
      .expect(201);
    expect(generated.body).toMatchObject({
      mode: 'generated',
      invoiceId: FINALIZED_INVOICE_ID,
      bucket: 'invoice-pdf-bucket',
      key: `invoices/${FINALIZED_INVOICE_ID}.pdf`,
    });

    mockInvoicePdfService.requestGeneration.mockResolvedValueOnce({
      mode: 'enqueued',
      invoiceId: FINALIZED_INVOICE_ID,
      bucket: null,
      key: null,
      generatedAt: null,
      taskId: 'task-invoice-pdf-1',
    });

    const enqueued = await request(app.getHttpServer())
      .post(`/api/invoices/${FINALIZED_INVOICE_ID}/pdf`)
      .set(auth())
      .expect(201);
    expect(enqueued.body).toMatchObject({
      mode: 'enqueued',
      invoiceId: FINALIZED_INVOICE_ID,
      taskId: 'task-invoice-pdf-1',
    });
  });

  it('streams a generated invoice PDF with application/pdf content type', async () => {
    mockInvoicePdfService.getPdf.mockResolvedValue({
      filename: 'invoice-RE-2026-0001.pdf',
      contentType: 'application/pdf',
      contentLength: 7,
      stream: Readable.from(Buffer.from('pdfdata')),
    });

    await request(app.getHttpServer())
      .get(`/api/invoices/${FINALIZED_INVOICE_ID}/pdf`)
      .set(auth())
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
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
