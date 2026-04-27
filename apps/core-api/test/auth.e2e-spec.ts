import { Controller, Get, UseGuards } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { SuperAdminGuard } from '../src/auth/super-admin.guard';
import { AllowPlatformAdmin } from '../src/common/decorators/allow-platform-admin.decorator';
import { PrismaService } from '../src/prisma/prisma.service';
import { SystemPrismaService } from '../src/prisma/system-prisma.service';

@Controller('protected')
class ProtectedController {
  @Get()
  getProtected() {
    return { ok: true };
  }
}

@Controller('platform/probe')
class PlatformProbeController {
  @AllowPlatformAdmin()
  @Get()
  @UseGuards(SuperAdminGuard)
  getPlatformProtected() {
    return { ok: true, scope: 'platform' };
  }
}

describe('Bearer auth (e2e)', () => {
  let app: INestApplication;
  let authService: AuthService;

  const prismaMock = {
    tenant: {
      findFirst: jest.fn(),
    },
  };

  const systemPrismaMock = {
    user: {
      findFirst: jest.fn(),
    },
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [ProtectedController, PlatformProbeController],
      providers: [
        {
          provide: APP_GUARD,
          useClass: JwtAuthGuard,
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(SystemPrismaService)
      .useValue(systemPrismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    authService = app.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaMock.tenant.findFirst.mockReset();
    systemPrismaMock.user.findFirst.mockReset();
  });

  it('rejects requests without bearer auth', async () => {
    await request(app.getHttpServer()).get('/protected').expect(401);
  });

  it('accepts a valid bearer token with tenantId and role claims', async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({
      id: 'tenant-active',
      is_active: true,
    });

    const token = authService.createTestToken({
      iss: 'firebase',
      tenantId: 'tenant-active',
      role: 'ADMIN',
    });

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: true });
  });

  it('returns 403 when the tenant is inactive', async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({
      id: 'tenant-inactive',
      is_active: false,
    });

    const token = authService.createTestToken({
      iss: 'firebase',
      tenantId: 'tenant-inactive',
      role: 'ADMIN',
    });

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('accepts platform-admin tokens on routes marked for platform access without tenantId', async () => {
    const token = authService.createTestToken({
      tenantId: undefined,
      role: undefined,
      platformRole: 'SUPER_ADMIN',
    } as never);

    await request(app.getHttpServer())
      .get('/platform/probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: true, scope: 'platform' });
  });

  it('still rejects normal tenant routes without tenantId and role claims', async () => {
    const token = authService.createTestToken({
      tenantId: undefined,
      role: undefined,
      platformRole: 'SUPER_ADMIN',
    } as never);

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('projects tenant claims from the database when token claims are missing', async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({
      id: 'tenant-active',
      is_active: true,
    });

    systemPrismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      firebaseUid: 'e2e-user-id',
      email: 'testauto@auto.core.at',
      active_tenant_id: 'tenant-active',
      platformAdmin: null,
      memberships: [
        {
          tenant_id: 'tenant-active',
          role: 'ADMIN',
          is_active: true,
          tenant: {
            id: 'tenant-active',
            is_active: true,
          },
        },
      ],
    });

    const token = authService.createTestToken({
      email: 'testauto@auto.core.at',
      tenantId: undefined,
      role: undefined,
    } as never);

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: true });
  });
});
