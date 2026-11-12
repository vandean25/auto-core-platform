import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe, GlobalExceptionFilter } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PlaywrightBrowserService } from '../src/common/services/playwright-browser.service.js';
import { CloudTasksService } from '../src/common/services/cloud-tasks.service.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { signPdfTaskPayload } from '../src/common/pdf/pdf-task-payload.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  type TestTenantResult,
} from './tenant-test-utils.js';

const WORKER_SECRET = 'warranty-claim-pdf-routes-e2e-worker-secret';
const PDF_BYTES = Buffer.from('%PDF-1.4 warranty-claim-route-test');

function createWarrantyClaimPdfStorageMock(bucket = 'test-invoice-pdf') {
  const objects = new Map<string, Buffer>();
  return {
    uploadPdf: async (params: { key: string; body: Buffer }) => {
      objects.set(params.key, params.body);
      return { bucket, key: params.key, etag: null };
    },
    getPdfStream: async (params: { bucket?: string; key: string }) => {
      const body = objects.get(params.key);
      if (!body) {
        throw new Error('PDF not found in storage');
      }
      const { Readable } = await import('node:stream');
      return {
        bucket: params.bucket ?? bucket,
        key: params.key,
        stream: Readable.from(body),
        contentType: 'application/pdf',
        contentLength: body.length,
      };
    },
  };
}

describe('Warranty claim PDF routes (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  let prisma: PrismaService;
  let authToken: string;
  let orderId: string;
  let claimId: string;
  let getBrowserSpy: jest.SpiedFunction<PlaywrightBrowserService['getBrowser']>;

  beforeAll(async () => {
    process.env.INVOICE_PDF_BUCKET = 'test-invoice-pdf';
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'http://127.0.0.1:3000/api';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(createWarrantyClaimPdfStorageMock())
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    basePrisma = app.get(PrismaService);
    authService = app.get(AuthService);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.CLOUD_TASKS_WORKER_SECRET = WORKER_SECRET;

    const browserService = app.get(PlaywrightBrowserService);
    getBrowserSpy = jest.spyOn(browserService, 'getBrowser');

    tenant = await createTestTenant(basePrisma, 'warranty-claim-pdf-routes');
    prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    authToken = createTestAuthToken(authService, tenant);
    const siteId = await resolveTestMainSiteId(basePrisma, tenant.tenantId);

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenant.tenantId,
        first_name: 'Pdf',
        last_name: 'Tester',
        type: 'PRIVATE',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customer.id,
        make: 'Demo',
        model: 'Van',
        year: 2022,
        vin: `PDFROUTE${Date.now()}`.padEnd(17, '0').slice(0, 17),
        plate: 'PDF-1',
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteId,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        order_number: `WO-PDF-${Date.now()}`,
        status: 'INTAKE',
        odometer: 12000,
        fuel_level: 50,
      },
    });
    orderId = order.id;
    const claim = await prisma.warrantyClaim.create({
      data: {
        tenant_id: tenant.tenantId,
        workshop_order_id: orderId,
        type: 'KULANZ',
        status: 'DRAFT',
        complaint: 'PDF route test',
      },
    });
    claimId = claim.id;
  });

  afterEach(async () => {
    getBrowserSpy?.mockRestore();
    await cleanupTestTenantGraph(basePrisma, tenant.tenantId).catch(() => undefined);
  });

  afterAll(async () => {
    await teardownTestApp(app, basePrisma);
  });

  it('does not launch a browser for user PDF enqueue/download routes when Cloud Tasks handles rendering', async () => {
    const cloudTasks = app.get(CloudTasksService);
    jest.spyOn(cloudTasks, 'isEnabled').mockReturnValue(true);
    jest
      .spyOn(cloudTasks, 'enqueuePdfGeneration')
      .mockImplementation(async () => ({ taskId: 'task-warranty-claim-1' }));

    await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${orderId}/warranty-claims/${claimId}/pdf`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    expect(getBrowserSpy).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/warranty-claims/${claimId}/pdf`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    expect(getBrowserSpy).not.toHaveBeenCalled();

    const payload = signPdfTaskPayload(
      { kind: 'warranty-claim', resourceId: claimId, tenantId: tenant.tenantId },
      WORKER_SECRET,
    );

    await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${orderId}/warranty-claims/${claimId}/pdf/worker`,
      )
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .set('x-tenant-id', tenant.tenantId)
      .send(payload)
      .expect(204);

    expect(getBrowserSpy).toHaveBeenCalled();
  });
});
