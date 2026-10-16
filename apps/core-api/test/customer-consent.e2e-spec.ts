import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { canContact } from '../src/customer-consent/customer-consent.permissions.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

jest.setTimeout(30000);

describe('Customer consent ledger (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let authToken: string;
  let otherAuthToken: string;
  let customerId: string;
  let otherCustomerId: string;
  let controllerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    const basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);

    const tenantA = await createTestTenant(basePrisma, 'aut589a');
    const tenantB = await createTestTenant(basePrisma, 'aut589b');
    tenantId = tenantA.tenantId;
    otherTenantId = tenantB.tenantId;
    authToken = createTestAuthToken(authService, tenantA);
    otherAuthToken = createTestAuthToken(authService, tenantB);

    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);

    const legalEntity = await prisma.legalEntity.findFirst({
      where: { tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    controllerId = legalEntity!.id;

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Pilot',
        last_name: 'Customer',
        email: `aut589-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const otherCustomer = await otherPrisma.customer.create({
      data: {
        first_name: 'Other',
        last_name: 'Tenant',
        email: `aut589-other-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    otherCustomerId = otherCustomer.id;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantId);
    await cleanupTestTenantGraph(
      createTenantAwarePrisma(app.get(PrismaService), otherTenantId),
      otherTenantId,
    );
    await teardownTestApp(app);
  });

  it('blocks marketing without consent and honours opt-out over grant', async () => {
    const prefsBefore = await request(app.getHttpServer())
      .get(`/api/customers/${customerId}/communication-preferences`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const marketingBefore = prefsBefore.body.preferences.find(
      (row: { purpose: string; channel: string }) =>
        row.purpose === 'MARKETING' && row.channel === 'EMAIL',
    );
    expect(marketingBefore.allowed).toBe(false);

    const revision = prefsBefore.body.revision;
    await request(app.getHttpServer())
      .post(`/api/customers/${customerId}/communication-events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: revision,
        idempotency_key: `grant-${Date.now()}`,
        channel: 'EMAIL',
        purpose: 'MARKETING',
        status: 'GRANTED',
        basis: 'CONSENT',
        source: 'PROFILE',
        contact_address: 'pilot.customer@example.com',
        text_version: 'mkt-v1',
        text_snapshot: 'Pilot customer marketing opt-in text',
      })
      .expect(201);

    const prefsGranted = await request(app.getHttpServer())
      .get(`/api/customers/${customerId}/communication-preferences`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const marketingGranted = prefsGranted.body.preferences.find(
      (row: { purpose: string; channel: string }) =>
        row.purpose === 'MARKETING' && row.channel === 'EMAIL',
    );
    expect(marketingGranted.allowed).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/customers/${customerId}/communication-events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: prefsGranted.body.revision,
        idempotency_key: `revoke-${Date.now()}`,
        channel: 'EMAIL',
        purpose: 'MARKETING',
        status: 'REVOKED',
        source: 'PROFILE',
        contact_address: 'pilot.customer@example.com',
      })
      .expect(201);

    const events = await prisma.customerConsent.findMany({
      where: { tenant_id: tenantId, customer_id: customerId },
      orderBy: { sequence: 'asc' },
    });
    const decision = canContact({
      purpose: 'MARKETING',
      channel: 'EMAIL',
      events,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('CONTACT_WITHDRAWN');
  });

  it('isolates consent rows by tenant', async () => {
    const foreign = await request(app.getHttpServer())
      .get(`/api/customers/${otherCustomerId}/communication-preferences`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
    expect(foreign.body.message).toMatch(/not found/i);
  });

  it('records audit log entries for consent changes', async () => {
    const audit = await prisma.auditLog.findFirst({
      where: {
        tenant_id: tenantId,
        entity_type: 'CustomerConsent',
      },
      orderBy: { created_at: 'desc' },
    });
    expect(audit).toBeTruthy();
  });
});
