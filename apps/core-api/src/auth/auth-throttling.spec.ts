import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthSessionService } from './auth-session.service';
import {
  AUTH_ME_RATE_LIMIT,
  AUTH_SWITCH_TENANT_RATE_LIMIT,
  AUTH_THROTTLER_OPTIONS,
  shouldThrottleAuthRoute,
} from './auth-throttling';

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
  });
});
