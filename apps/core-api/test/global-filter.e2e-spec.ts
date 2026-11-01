import { AuthService } from '../src/auth/auth.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { Controller, INestApplication, HttpStatus, Post } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenantAwarePrisma, createTestAuthToken, createTestTenant } from './tenant-test-utils.js';
import {
  createGlobalValidationPipe,
  GlobalExceptionFilter,
} from '../src/common/index.js';
import { Public } from '../src/common/decorators/public.decorator.js';
import { applyInProgress } from '../src/import/import-job.errors.js';
import { teardownTestApp } from './test-lifecycle.js';

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The apply endpoint no longer emits IMPORT_APPLY_IN_PROGRESS for a running job (AUT-788 returns 202), so this
 * probe keeps the global filter contract pinned at the HTTP boundary.
 */
@Controller('import-apply-conflict-probe')
class ImportApplyConflictProbeController {
  @Public()
  @Post('live-lease')
  liveLease(): never {
    throw applyInProgress('2026-10-28T12:00:00.000Z');
  }

  @Public()
  @Post('no-lease')
  noLease(): never {
    throw applyInProgress();
  }
}

describe('GlobalExceptionFilter (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ImportApplyConflictProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const testTenant = await createTestTenant(prisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(prisma, testTenant.tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  it('should map Prisma P2002 (Unique Constraint) to 409 Conflict', async () => {
    const email = `filter-test-${Date.now()}@example.com`;

    // Create first customer
    await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Filter',
        last_name: 'Test',
        email,
      },
    });

    // Try to create another with same email via API
    const response = await request(app.getHttpServer())
      .post('/api/customers')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        first_name: 'Duplicate',
        last_name: 'User',
        email,
      });

    // The service might already handle P2002 and throw ConflictException
    // But if it didn't, the filter would catch it.
    expect(response.status).toBe(HttpStatus.CONFLICT);
    expect(response.body).toMatchObject({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
    });
  });

  it('should map Prisma P2025 (Not Found) to 404 Not Found', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const response = await request(app.getHttpServer())
      .get(`/api/sales/invoices/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Not Found',
    });
  });

  it('should keep standard error response shape for validation errors', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/customers')
        .set('Authorization', `Bearer ${authToken}`)
      .send({}); // Missing required fields

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body).toHaveProperty('statusCode');
    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('error');
  });

  it('returns 413 for an unauthenticated JSON body over 100 KiB (AUT-731)', async () => {
    const oversizedBody = JSON.stringify({
      padding: 'x'.repeat(101 * 1024),
    });

    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set('Content-Type', 'application/json')
      .send(oversizedBody);

    expect(response.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(response.body).toMatchObject({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      error: 'Payload Too Large',
      code: 'HTTP_413',
    });
    expect(response.body).toHaveProperty('message');
    expect(response.body).not.toHaveProperty('requestId');
    expect(response.body).not.toHaveProperty('eventId');
    // AUT-746: the body parsers fail before the request middleware, so the filter supplies the id.
    expect(response.headers['x-request-id']).toMatch(REQUEST_ID_PATTERN);
  });

  it.each([
    {
      encoding: 'gzip',
      body: Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]),
      requestId: 'req-invalid-gzip',
    },
    {
      encoding: 'deflate',
      body: Buffer.from([0x78, 0x9c, 0xff, 0xff, 0x00, 0x00, 0x00]),
    },
  ])(
    'returns 400 for an unauthenticated $encoding body with invalid bytes (AUT-744)',
    async ({ encoding, body, requestId }) => {
      let httpRequest = request(app.getHttpServer())
        .post('/api/customers')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', encoding);
      if (requestId) {
        httpRequest = httpRequest.set('x-request-id', requestId);
      }
      const response = await httpRequest.send(body);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body).toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: 'HTTP_400',
        message: 'Invalid request body encoding',
      });
      expect(response.body).not.toHaveProperty('eventId');
      expect(JSON.stringify(response.body)).not.toMatch(/Z_DATA_ERROR|zlib/i);
      if (requestId) {
        expect(response.headers['x-request-id']).toBe(requestId);
      } else {
        expect(response.headers['x-request-id']).toMatch(REQUEST_ID_PATTERN);
      }
    },
  );

  it('returns 400 for unauthenticated invalid JSON with a generated x-request-id (AUT-746)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body).toMatchObject({
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'HTTP_400',
    });
    expect(response.headers['x-request-id']).toMatch(REQUEST_ID_PATTERN);
  });

  it('returns 415 with an x-request-id when the body uses an unsupported content encoding (AUT-746)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'br')
      .send(Buffer.from('not brotli'));

    expect(response.status).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    expect(response.body).toMatchObject({
      statusCode: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      error: 'Unsupported Media Type',
      code: 'HTTP_415',
    });
    expect(response.headers['x-request-id']).toMatch(REQUEST_ID_PATTERN);
  });

  it('keeps leaseExpiresAt on an IMPORT_APPLY_IN_PROGRESS 409 response (AUT-796)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/import-apply-conflict-probe/live-lease')
      .expect(HttpStatus.CONFLICT);

    expect(response.body).toMatchObject({
      statusCode: HttpStatus.CONFLICT,
      message: 'Import job is already being applied',
      error: 'Conflict',
      code: 'IMPORT_APPLY_IN_PROGRESS',
      leaseExpiresAt: '2026-10-28T12:00:00.000Z',
      params: { leaseExpiresAt: '2026-10-28T12:00:00.000Z' },
    });
  });

  it('reports a null leaseExpiresAt on an IMPORT_APPLY_IN_PROGRESS 409 without a lease (AUT-796)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/import-apply-conflict-probe/no-lease')
      .expect(HttpStatus.CONFLICT);

    expect(response.body).toMatchObject({
      statusCode: HttpStatus.CONFLICT,
      message: 'Import job is already being applied',
      error: 'Conflict',
      code: 'IMPORT_APPLY_IN_PROGRESS',
      leaseExpiresAt: null,
      params: { leaseExpiresAt: null },
    });
  });
});
