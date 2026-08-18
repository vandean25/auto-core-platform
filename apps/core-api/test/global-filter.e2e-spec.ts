import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantAwarePrisma, createTestAuthToken, createTestTenant } from './tenant-test-utils';
import { GlobalExceptionFilter } from '../src/common';
import { teardownTestApp } from './test-lifecycle';

describe('GlobalExceptionFilter (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const testTenant = await createTestTenant(prisma);
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
});
