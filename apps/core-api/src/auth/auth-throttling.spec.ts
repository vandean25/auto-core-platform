import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuthController } from './auth.controller.js';
import { AuthSessionService } from './auth-session.service.js';
import { ScopeContextResponseHeadersInterceptor } from './scope-context/scope-context-response-headers.interceptor.js';
import { ScopeContextLogoutService } from './scope-context/scope-context-logout.service.js';
import { ScopeContextService } from './scope-context/scope-context.service.js';
import {
  AUTH_ME_RATE_LIMIT,
  AUTH_SWITCH_TENANT_RATE_LIMIT,
  AUTH_THROTTLER_OPTIONS,
  shouldThrottleAuthRoute,
} from './auth-throttling.js';

describe('auth throttling', () => {
  it('selects only auth routes after the API prefix', () => {
    expect(
      shouldThrottleAuthRoute({
        method: 'GET',
        originalUrl: '/api/auth/me',
      } as Request),
    ).toBe(true);
    expect(
      shouldThrottleAuthRoute({
        method: 'POST',
        originalUrl: '/api/auth/switch-tenant',
      } as Request),
    ).toBe(true);
    expect(
      shouldThrottleAuthRoute({
        method: 'POST',
        originalUrl: '/api/auth/scope-context',
      } as Request),
    ).toBe(true);
    expect(
      shouldThrottleAuthRoute({
        method: 'POST',
        originalUrl: '/api/auth/logout',
      } as Request),
    ).toBe(true);
    expect(
      shouldThrottleAuthRoute({
        method: 'GET',
        originalUrl: '/api/customers',
      } as Request),
    ).toBe(false);
  });

  it('defines a generous read bucket and tighter write bucket', () => {
    expect(AUTH_ME_RATE_LIMIT).toEqual({ limit: 120, ttl: 60_000 });
    expect(AUTH_SWITCH_TENANT_RATE_LIMIT).toEqual({
      limit: 10,
      ttl: 60_000,
    });
  });
});

@Controller('customers')
class CustomersController {
  @Get()
  listCustomers() {
    return { data: [] };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([AUTH_THROTTLER_OPTIONS])],
  controllers: [AuthController, CustomersController],
  providers: [
    {
      provide: AuthSessionService,
      useValue: {
        getSessionForAuthenticatedUser: jest.fn().mockResolvedValue({}),
        switchTenant: jest.fn().mockResolvedValue({}),
      },
    },
    {
      provide: ScopeContextService,
      useValue: {
        handshake: jest.fn().mockResolvedValue({
          scopeContext: 'sc',
          scopeContextDigest: 'digest',
          continuityDigest: 'lineage',
        }),
      },
    },
    {
      provide: ScopeContextLogoutService,
      useValue: { logout: jest.fn() },
    },
    ScopeContextResponseHeadersInterceptor,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
class AuthThrottlingTestModule {}

describe('auth throttling integration', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthThrottlingTestModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: unknown }).user = {
        userId: 'user-1',
        email: 'user@example.com',
        tenantId: 'tenant-1',
        role: 'ADMIN',
      };
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('uses separate auth buckets and skips non-auth routes', async () => {
    const server = app.getHttpServer();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(server)
        .post('/auth/switch-tenant')
        .send({ tenantId: 'tenant-1' })
        .expect(200);
    }
    await request(server)
      .post('/auth/switch-tenant')
      .send({ tenantId: 'tenant-1' })
      .expect(429);

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await request(server).get('/auth/me').expect(200);
    }

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await request(server).get('/customers').expect(200);
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(server)
        .post('/auth/scope-context')
        .set('Authorization', 'Bearer test-token')
        .expect(200);
    }
    await request(server)
      .post('/auth/scope-context')
      .set('Authorization', 'Bearer test-token')
      .expect(429);
  });
});
