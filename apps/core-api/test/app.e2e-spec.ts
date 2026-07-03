import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestTenant } from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let authToken: string;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(() => {});

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    const testTenant = await createTestTenant(prisma, 'app-root');
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

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/api')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect('Hello World!');
  });
});
