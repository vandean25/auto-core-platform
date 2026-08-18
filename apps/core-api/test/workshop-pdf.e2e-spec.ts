import { AuthService } from '../src/auth/auth.service';
import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Readable } from 'node:stream';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkshopPdfService } from '../src/workshop/workshop-pdf.service';
import { signPdfTaskPayload } from '../src/common';
import { teardownTestApp } from './test-lifecycle';
import {
  createTestAuthToken,
  createTestTenant,
  cleanupTestTenantGraph,
} from './tenant-test-utils';

const WORKER_SECRET = 'workshop-pdf-e2e-worker-secret';
const WORKSHOP_ORDER_ID = '11111111-1111-1111-1111-111111111111';

describe('Workshop PDF endpoints (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  let tenantId: string;

  const mockPdfService = {
    requestGeneration: jest.fn(),
    getPdf: jest.fn(),
    generateNow: jest.fn(),
  };

  beforeAll(() => {});

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.CLOUD_TASKS_WORKER_SECRET = WORKER_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WorkshopPdfService)
      .useValue(mockPdfService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    const testTenant = await createTestTenant(prisma, 'workshop-pdf');
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

  it('returns ready JSON when workshop PDF generation finishes inline', async () => {
    mockPdfService.requestGeneration.mockResolvedValue({
      mode: 'generated',
      workshopOrderId: '11111111-1111-1111-1111-111111111111',
    });

    await request(app.getHttpServer())
      .post('/api/workshop/orders/11111111-1111-1111-1111-111111111111/pdf')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201)
      .expect({
        message: 'PDF is ready',
        enqueued: false,
      });
  });

  it('returns enqueued JSON when workshop PDF generation is queued', async () => {
    mockPdfService.requestGeneration.mockResolvedValue({
      mode: 'enqueued',
      workshopOrderId: '11111111-1111-1111-1111-111111111111',
      taskId: 'task-123',
    });

    await request(app.getHttpServer())
      .post('/api/workshop/orders/11111111-1111-1111-1111-111111111111/pdf')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201)
      .expect({
        message: 'PDF generation enqueued',
        enqueued: true,
        taskId: 'task-123',
      });
  });

  it('streams workshop PDFs with an application/pdf content type', async () => {
    mockPdfService.getPdf.mockResolvedValue({
      filename: 'job-card-WO-1.pdf',
      contentType: 'application/pdf',
      contentLength: 7,
      stream: Readable.from(Buffer.from('pdfdata')),
    });

    await request(app.getHttpServer())
      .get('/api/workshop/orders/11111111-1111-1111-1111-111111111111/pdf')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
  });

  it('returns 404 when the workshop PDF is not generated yet', async () => {
    mockPdfService.getPdf.mockRejectedValue(
      new NotFoundException('Workshop PDF is not generated yet'),
    );

    await request(app.getHttpServer())
      .get('/api/workshop/orders/11111111-1111-1111-1111-111111111111/pdf')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });

  it('runs the worker when the signed payload tenant matches the header', async () => {
    mockPdfService.generateNow.mockResolvedValue({
      workshopOrderId: WORKSHOP_ORDER_ID,
    });
    const payload = signPdfTaskPayload(
      {
        kind: 'workshop-order',
        resourceId: WORKSHOP_ORDER_ID,
        tenantId,
      },
      WORKER_SECRET,
    );

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${WORKSHOP_ORDER_ID}/pdf/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .set('x-tenant-id', tenantId)
      .send(payload)
      .expect(204);

    expect(mockPdfService.generateNow).toHaveBeenCalledWith(WORKSHOP_ORDER_ID);
  });

  it('rejects the worker when x-tenant-id differs from the signed payload tenant', async () => {
    const payload = signPdfTaskPayload(
      {
        kind: 'workshop-order',
        resourceId: WORKSHOP_ORDER_ID,
        tenantId,
      },
      WORKER_SECRET,
    );

    await request(app.getHttpServer())
      .post(`/api/workshop/orders/${WORKSHOP_ORDER_ID}/pdf/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000099')
      .send(payload)
      .expect(403);

    expect(mockPdfService.generateNow).not.toHaveBeenCalled();
  });
});
