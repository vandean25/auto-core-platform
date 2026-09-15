import {
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthenticatedUser } from '../src/auth/types/authenticated-user.js';
import { teardownTestApp } from './test-lifecycle.js';

const firebaseAuthMock = {
  getUser: jest.fn(),
  setCustomUserClaims: jest.fn(),
  revokeRefreshTokens: jest.fn(),
  getUserByEmail: jest.fn(),
  createUser: jest.fn(),
};

const TENANT_A_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_B_ID = '22222222-2222-4222-8222-222222222222';

jest.unstable_mockModule('../src/auth/firebase-admin.js', () => ({
  getFirebaseAdminAuth: () => firebaseAuthMock,
}));

const { AuthModule } = await import('../src/auth/auth.module.js');
const { AuthService } = await import('../src/auth/auth.service.js');
const { JwtAuthGuard } = await import('../src/auth/jwt-auth.guard.js');
const { SuperAdminGuard } = await import('../src/auth/super-admin.guard.js');
const { AllowPlatformAdmin } = await import(
  '../src/common/decorators/allow-platform-admin.decorator.js'
);
const { createGlobalValidationPipe } = await import('../src/common/index.js');
const { PrismaService } = await import('../src/prisma/prisma.service.js');
const { SystemPrismaService } = await import(
  '../src/prisma/system-prisma.service.js'
);

@Controller('protected')
class ProtectedController {
  @Get()
  getProtected() {
    return { ok: true };
  }

  @Get('me')
  getProtectedUser(@Req() request: { user: AuthenticatedUser }) {
    return request.user;
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
      update: jest.fn(),
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
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    authService = app.get(AuthService);
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  beforeEach(() => {
    prismaMock.tenant.findFirst.mockReset();
    systemPrismaMock.user.findFirst.mockReset();
    systemPrismaMock.user.update.mockReset();
    firebaseAuthMock.getUser.mockReset();
    firebaseAuthMock.setCustomUserClaims.mockReset();
    firebaseAuthMock.revokeRefreshTokens.mockReset();
    firebaseAuthMock.getUserByEmail.mockReset();
    firebaseAuthMock.createUser.mockReset();
  });

  it('rejects requests without bearer auth', async () => {
    await request(app.getHttpServer()).get('/protected').expect(401);
  });

  it('rejects a valid bearer token with tenantId and role claims when membership is missing', async () => {
    const token = authService.createTestToken({
      iss: 'firebase',
      tenantId: 'tenant-active',
      role: 'ADMIN',
    });

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a deactivated membership even when stale tenant claims remain', async () => {
    systemPrismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      firebaseUid: 'e2e-user-id',
      email: 'e2e@example.com',
      active_tenant_id: 'tenant-active',
      platformAdmin: null,
      memberships: [],
    });

    const token = authService.createTestToken({
      iss: 'firebase',
      tenantId: 'tenant-active',
      role: 'ADMIN',
    });

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('accepts platform-admin tokens only when an active PlatformAdmin row exists', async () => {
    systemPrismaMock.user.findFirst.mockResolvedValue({
      id: 'platform-user-1',
      firebaseUid: 'e2e-user-id',
      email: 'e2e@example.com',
      active_tenant_id: null,
      platformAdmin: {
        is_active: true,
        role: 'SUPER_ADMIN',
      },
      memberships: [],
    });

    const token = authService.createTestToken({
      tenantId: undefined,
      role: undefined,
      platformRole: 'SUPER_ADMIN',
    });

    await request(app.getHttpServer())
      .get('/platform/probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: true, scope: 'platform' });
  });

  it('rejects platform-admin tokens that only have a platformRole claim', async () => {
    const token = authService.createTestToken({
      tenantId: undefined,
      role: undefined,
      platformRole: 'SUPER_ADMIN',
    });

    await request(app.getHttpServer())
      .get('/platform/probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects stale platform-admin claims when the database no longer grants platform access', async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({
      id: TENANT_A_ID,
      is_active: true,
    });

    systemPrismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      firebaseUid: 'e2e-user-id',
      email: 'testauto@auto.core.at',
      active_tenant_id: TENANT_A_ID,
      platformAdmin: null,
      memberships: [
        {
          tenant_id: TENANT_A_ID,
          role: 'ADMIN',
          is_active: true,
          tenant: {
            id: TENANT_A_ID,
            name: 'Auto Core Vienna',
            slug: 'vienna',
            is_active: true,
          },
        },
      ],
    });

    const token = authService.createTestToken({
      email: 'testauto@auto.core.at',
      tenantId: undefined,
      role: undefined,
      platformRole: 'SUPER_ADMIN',
    });

    await request(app.getHttpServer())
      .get('/platform/probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('still rejects normal tenant routes without tenantId and role claims', async () => {
    const token = authService.createTestToken({
      tenantId: undefined,
      role: undefined,
      platformRole: 'SUPER_ADMIN',
    });

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
    });

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { ok: true });
  });

  it('uses the database active tenant instead of stale token tenant claims', async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({
      id: 'tenant-db',
      is_active: true,
    });

    systemPrismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      firebaseUid: 'e2e-user-id',
      email: 'testauto@auto.core.at',
      active_tenant_id: 'tenant-db',
      platformAdmin: null,
      memberships: [
        {
          tenant_id: 'tenant-db',
          role: 'ADMIN',
          is_active: true,
          tenant: {
            id: 'tenant-db',
            name: 'Auto Core HQ',
            slug: 'hq',
            is_active: true,
          },
        },
      ],
    });

    const token = authService.createTestToken({
      email: 'testauto@auto.core.at',
      tenantId: 'tenant-stale',
      role: 'SALES',
    });

    await request(app.getHttpServer())
      .get('/protected/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.tenantId).toBe('tenant-db');
        expect(body.role).toBe('ADMIN');
      });
  });

  it('returns the active tenant and memberships from GET /auth/me', async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({
      id: 'tenant-a',
      is_active: true,
    });

    systemPrismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      firebaseUid: 'e2e-user-id',
      email: 'testauto@auto.core.at',
      active_tenant_id: 'tenant-a',
      platformAdmin: {
        is_active: true,
        role: 'SUPER_ADMIN',
      },
      memberships: [
        {
          tenant_id: 'tenant-a',
          role: 'ADMIN',
          is_active: true,
          tenant: {
            id: 'tenant-a',
            name: 'Auto Core Vienna',
            slug: 'vienna',
            is_active: true,
          },
        },
        {
          tenant_id: 'tenant-b',
          role: 'SALES',
          is_active: true,
          tenant: {
            id: 'tenant-b',
            name: 'Auto Core Graz',
            slug: 'graz',
            is_active: true,
          },
        },
      ],
    });

    const token = authService.createTestToken({
      email: 'testauto@auto.core.at',
      tenantId: undefined,
      role: undefined,
    });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.activeTenant).toEqual({
          id: 'tenant-a',
          name: 'Auto Core Vienna',
          slug: 'vienna',
        });
        expect(body.activeRole).toBe('ADMIN');
        expect(body.platformRole).toBe('SUPER_ADMIN');
        expect(body.memberships).toHaveLength(2);
      });
  });

  it('switches the active tenant when the membership exists', async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({
      id: TENANT_A_ID,
      is_active: true,
    });

    systemPrismaMock.user.findFirst
      .mockResolvedValueOnce({
        id: 'user-1',
        firebaseUid: 'e2e-user-id',
        email: 'testauto@auto.core.at',
        active_tenant_id: TENANT_A_ID,
        platformAdmin: null,
        memberships: [
          {
            tenant_id: TENANT_A_ID,
            role: 'ADMIN',
            is_active: true,
            tenant: {
              id: TENANT_A_ID,
              name: 'Auto Core Vienna',
              slug: 'vienna',
              is_active: true,
            },
          },
          {
            tenant_id: TENANT_B_ID,
            role: 'SALES',
            is_active: true,
            tenant: {
              id: TENANT_B_ID,
              name: 'Auto Core Graz',
              slug: 'graz',
              is_active: true,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'user-1',
        firebaseUid: 'e2e-user-id',
        email: 'testauto@auto.core.at',
        active_tenant_id: TENANT_B_ID,
        platformAdmin: null,
        memberships: [
          {
            tenant_id: TENANT_A_ID,
            role: 'ADMIN',
            is_active: true,
            tenant: {
              id: TENANT_A_ID,
              name: 'Auto Core Vienna',
              slug: 'vienna',
              is_active: true,
            },
          },
          {
            tenant_id: TENANT_B_ID,
            role: 'SALES',
            is_active: true,
            tenant: {
              id: TENANT_B_ID,
              name: 'Auto Core Graz',
              slug: 'graz',
              is_active: true,
            },
          },
        ],
      });
    systemPrismaMock.user.update.mockResolvedValue({ id: 'user-1' });
    firebaseAuthMock.getUser.mockResolvedValue({
      uid: 'e2e-user-id',
      customClaims: {},
    });
    firebaseAuthMock.setCustomUserClaims.mockResolvedValue(undefined);

    const token = authService.createTestToken({
      email: 'testauto@auto.core.at',
      tenantId: undefined,
      role: undefined,
    });

    await request(app.getHttpServer())
      .post('/auth/switch-tenant')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantId: TENANT_B_ID })
      .expect(200)
      .expect(({ body }) => {
        expect(body.activeTenant).toEqual({
          id: TENANT_B_ID,
          name: 'Auto Core Graz',
          slug: 'graz',
        });
        expect(body.activeRole).toBe('SALES');
      });
  });

  it('rejects malformed tenant ids when switching tenants', async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({
      id: TENANT_A_ID,
      is_active: true,
    });

    systemPrismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      firebaseUid: 'e2e-user-id',
      email: 'testauto@auto.core.at',
      active_tenant_id: TENANT_A_ID,
      platformAdmin: null,
      memberships: [
        {
          tenant_id: TENANT_A_ID,
          role: 'ADMIN',
          is_active: true,
          tenant: {
            id: TENANT_A_ID,
            name: 'Auto Core Vienna',
            slug: 'vienna',
            is_active: true,
          },
        },
      ],
    });

    const token = authService.createTestToken({
      email: 'testauto@auto.core.at',
      tenantId: undefined,
      role: undefined,
    });

    await request(app.getHttpServer())
      .post('/auth/switch-tenant')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantId: 'tenant-b' })
      .expect(400);

    expect(systemPrismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a token with emailVerified: false and unknown sub even when email matches a User row', async () => {
    systemPrismaMock.user.findFirst.mockResolvedValue(null);

    const token = authService.createTestToken({
      sub: 'attacker-sub',
      email: 'testauto@auto.core.at',
      emailVerified: false,
    });

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(systemPrismaMock.user.findFirst).toHaveBeenCalledTimes(1);
    expect(systemPrismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { firebaseUid: 'attacker-sub' },
      }),
    );
  });

  it('rejects a token with unknown sub even if emailVerified: true when User row is bound to another UID', async () => {
    systemPrismaMock.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const token = authService.createTestToken({
      sub: 'attacker-sub',
      email: 'testauto@auto.core.at',
      emailVerified: true,
    });

    await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(systemPrismaMock.user.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { firebaseUid: 'attacker-sub' },
      }),
    );
    expect(systemPrismaMock.user.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { email: 'testauto@auto.core.at', firebaseUid: null },
      }),
    );
  });
});
