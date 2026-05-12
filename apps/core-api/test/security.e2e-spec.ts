import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestTenant } from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Security (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    const testTenant = await createTestTenant(prisma, 'security-root');
    tenantId = testTenant.tenantId;
    authToken = app.get(AuthService).createTestToken({ tenantId });
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    await teardownTestApp(app, prisma);
  });

  it('should allow access with valid API key', () => {
    return request(app.getHttpServer())
      .get('/api')
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('should block access without API key', () => {
    return request(app.getHttpServer()).get('/api').expect(401);
  });

  it('should block access with invalid API key', () => {
    return request(app.getHttpServer())
      .get('/api')
        .set('Authorization', `Bearer invalid-token`)
      .expect(401);
  });
});
