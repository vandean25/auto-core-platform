import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { ApiRootModule } from '../api-root.module.js';
import { AppController } from '../app.controller.js';
import { AppService } from '../app.service.js';
import { CustomerController } from '../customer/customer.controller.js';
import { CustomerService } from '../customer/customer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushController } from '../push/push.controller.js';
import { PushService } from '../push/push.service.js';
import {
  formatMatrixSummary,
  runDecisionMatrix,
  type MatrixResult,
} from './decision-matrix.js';
import { PermissionGuard } from './permission.guard.js';
import { PermissionResolver } from './permission-resolver.js';
import {
  listRegisteredMcpTools,
  listRegisteredRoutes,
} from './route-inventory.js';

/**
 * Binding rule for AUT-865 (1c) and AUT-866 (1d): this matrix only compares what the guards decide
 * (TECH mechanic restriction, DEMO mask, API key, session, public, platform and service-job policies,
 * MCP transport and supervisor roles). The OWNER / ADMIN / SALES distinctions live in the services.
 * Every PR that switches a consumer to PermissionGuard brings a table-driven contract test per service
 * (each legacy role x each operation it touches: legacy decision == new decision) and removes the old
 * service check only in that same PR.
 */
describe('legacy/new decision matrix', () => {
  const routes = listRegisteredRoutes(ApiRootModule);
  let result: MatrixResult;

  beforeAll(async () => {
    result = await runDecisionMatrix(routes, await listRegisteredMcpTools());
  });

  // Scenario 1
  it('decides identically in the legacy guards and the resolver for every route and MCP tool x role (zero diffs)', () => {
    console.info(formatMatrixSummary(result.summary));

    expect(result.summary.diffs).toEqual([]);
    expect(result.summary.routes).toBe(routes.length);
    expect(result.summary.mcpTools).toBeGreaterThan(50);
    expect(result.summary.compared).toBeGreaterThan(3000);
    expect(result.summary.allows).toBeGreaterThan(0);
    expect(result.summary.denies).toBeGreaterThan(0);
  });

  // Scenario 2
  it('denies a TECH member on every back-office route in the legacy guards and in the resolver (403)', () => {
    const techBackOffice = result.rows.filter(
      (row) =>
        row.principal === 'TECH' &&
        row.target === 'route' &&
        row.kind === 'protected' &&
        !row.mechanicAccessible,
    );

    expect(techBackOffice.length).toBeGreaterThan(300);
    expect(
      techBackOffice.filter(
        (row) =>
          row.legacy !== 'deny' ||
          row.legacyError !== 'ForbiddenException' ||
          row.resolver !== 'deny' ||
          row.resolverError !== 'ForbiddenException',
      ),
    ).toEqual([]);
  });

  // Scenario 6. Synthetic: TenantMemberRole is required, so the legacy model has no member without a
  // domain role. TODO(phase 2): replace the synthetic membership with a real role-less member.
  it('synthetic: a member without a domain role registers a push device but gets 403 on the greeting and on tenant data', async () => {
    const membership = { role: null, demo_access_expires_at: null };
    const prisma = {
      tenantMember: {
        findFirst: jest
          .fn<(args: object) => Promise<object | null>>()
          .mockResolvedValue(membership),
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController, PushController, CustomerController],
      providers: [
        { provide: AppService, useValue: { getHello: () => 'Hello World!' } },
        {
          provide: PushService,
          useValue: {
            registerDevice: () => Promise.resolve({ id: 'device-1' }),
          },
        },
        {
          provide: CustomerService,
          useValue: { findAll: () => Promise.resolve({ data: [], meta: {} }) },
        },
        { provide: PrismaService, useValue: prisma },
        PermissionResolver,
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, {
        user: { userId: 'firebase-uid-1', tenantId: 'tenant-1', role: '' },
      });
      next();
    });
    await app.init();

    try {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const register = await request(server)
        .post('/api/v1/me/push/devices')
        .send({ token: 'device-token', platform: 'DESKTOP' });
      const greeting = await request(server).get('/api');
      const customers = await request(server).get('/api/customers');

      expect([register.status, greeting.status, customers.status]).toEqual([
        201, 403, 403,
      ]);
    } finally {
      await app.close();
    }
  });
});
