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
import { teardownTestApp } from './test-lifecycle';
import { createTestTenant } from './tenant-test-utils';

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
    authToken = app.get(AuthService).createTestToken({ tenantId });
  });

  afterEach(async () => {
    if (tenantId) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
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
});
