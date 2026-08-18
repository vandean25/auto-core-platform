import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { LogLevelService } from '../src/common/logging/log-level.service';
import {
  createTestAuthToken,
  createTestPlatformAdmin,
  createTestTenant,
  cleanupTestTenantGraph,
  cleanupTestUsers,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Operational Log-Level Controls (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let logLevelService: LogLevelService;

  let tenantId: string;
  let tenantUserHeader: string;
  let superAdminHeader: string;
  let platformAdminUserId: string;

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
    logLevelService = app.get<LogLevelService>(LogLevelService);

    const testTenant = await createTestTenant(prisma, 'log-level-tenant');
    tenantId = testTenant.tenantId;

    tenantUserHeader = `Bearer ${createTestAuthToken(authService, testTenant)}`;

    const platformAdmin = await createTestPlatformAdmin(prisma, {
      email: 'super-admin@platform.local',
    });
    platformAdminUserId = platformAdmin.userId;
    superAdminHeader = `Bearer ${authService.createTestToken({
      sub: platformAdmin.firebaseUid,
      email: platformAdmin.email,
      platformRole: 'SUPER_ADMIN',
    })}`;
  });

  afterAll(async () => {
    logLevelService.resetLogLevel();
    await cleanupTestTenantGraph(prisma, tenantId);
    await cleanupTestUsers(prisma, [platformAdminUserId]);
    await teardownTestApp(app, prisma);
  });

  beforeEach(() => {
    logLevelService.resetLogLevel();
  });

  it('1. Anonymous requests are rejected with 401 Unauthorized', async () => {
    await request(app.getHttpServer())
      .get('/admin/settings/log-level')
      .expect(401);

    await request(app.getHttpServer())
      .patch('/admin/settings/log-level')
      .send({ level: 'debug', durationMinutes: 30 })
      .expect(401);
  });

  it('2. Regular tenant admin without SUPER_ADMIN platform role is rejected with 403 Forbidden', async () => {
    await request(app.getHttpServer())
      .get('/admin/settings/log-level')
      .set('Authorization', tenantUserHeader)
      .expect(403);

    await request(app.getHttpServer())
      .patch('/admin/settings/log-level')
      .set('Authorization', tenantUserHeader)
      .send({ level: 'debug', durationMinutes: 30 })
      .expect(403);
  });

  it('3. Platform SUPER_ADMIN can inspect current operational log level settings', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/settings/log-level')
      .set('Authorization', superAdminHeader)
      .expect(200);

    expect(response.body).toHaveProperty('currentLevel');
    expect(response.body).toHaveProperty('defaultLevel');
    expect(['error', 'warn', 'log', 'debug', 'verbose']).toContain(
      response.body.currentLevel,
    );
  });

  it('4. Platform SUPER_ADMIN can dynamically update log level with TTL', async () => {
    const patchResponse = await request(app.getHttpServer())
      .patch('/admin/settings/log-level')
      .set('Authorization', superAdminHeader)
      .send({
        level: 'debug',
        durationMinutes: 45,
      })
      .expect(200);

    expect(patchResponse.body.currentLevel).toBe('debug');
    expect(patchResponse.body.override).toBeDefined();
    expect(patchResponse.body.override.level).toBe('debug');
    expect(patchResponse.body.override.expiresAt).toBeDefined();

    // Verify GET also reflects active override
    const getResponse = await request(app.getHttpServer())
      .get('/admin/settings/log-level')
      .set('Authorization', superAdminHeader)
      .expect(200);

    expect(getResponse.body.currentLevel).toBe('debug');
    expect(getResponse.body.override.level).toBe('debug');
  });

  it('5. Rejects invalid log level and invalid durations with 400 Bad Request', async () => {
    await request(app.getHttpServer())
      .patch('/admin/settings/log-level')
      .set('Authorization', superAdminHeader)
      .send({
        level: 'invalid_level',
        durationMinutes: 30,
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/admin/settings/log-level')
      .set('Authorization', superAdminHeader)
      .send({
        level: 'debug',
        durationMinutes: 5000, // Max is 1440
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/admin/settings/log-level')
      .set('Authorization', superAdminHeader)
      .send({
        level: 'debug',
        durationMinutes: 0, // Min is 1
      })
      .expect(400);
  });
});
