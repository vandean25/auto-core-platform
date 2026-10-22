import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  canContact,
  type LedgerEventSlice,
} from '../src/customer-consent/customer-consent.permissions.js';
import { mintUnsubscribeToken } from '../src/customer-consent/customer-consent-token.helpers.js';
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
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

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
        tenant_id: tenantId,
        first_name: 'Sample',
        last_name: 'Customer',
        email: `aut589-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const otherCustomer = await otherPrisma.customer.create({
      data: {
        tenant_id: otherTenantId,
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
        row.purpose === 'NEWSLETTER' && row.channel === 'EMAIL',
    );
    expect(marketingBefore.allowed).toBe(false);

    const revision = prefsBefore.body.revision;
    await request(app.getHttpServer())
      .post(`/api/customers/${customerId}/communication-events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        controller_legal_entity_id: controllerId,
        expected_revision: revision,
        idempotency_key: `grant-${Date.now()}`,
        channel: 'EMAIL',
        purpose: 'NEWSLETTER',
        status: 'GRANTED',
        basis: 'CONSENT',
        source: 'PROFILE',
        contact_address: 'sample.customer@example.com',
        text_version: 'mkt-v1',
        text_language: 'en',
        text_snapshot: 'Optional marketing email consent wording shown to the customer.',
      })
      .expect(201);

    const prefsGranted = await request(app.getHttpServer())
      .get(`/api/customers/${customerId}/communication-preferences`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const marketingGranted = prefsGranted.body.preferences.find(
      (row: { purpose: string; channel: string }) =>
        row.purpose === 'NEWSLETTER' && row.channel === 'EMAIL',
    );
    expect(marketingGranted.allowed).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/customers/${customerId}/communication-events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        controller_legal_entity_id: controllerId,
        expected_revision: prefsGranted.body.revision,
        idempotency_key: `revoke-${Date.now()}`,
        channel: 'EMAIL',
        purpose: 'NEWSLETTER',
        status: 'REVOKED',
        source: 'PROFILE',
        contact_address: 'sample.customer@example.com',
      })
      .expect(201);

    const consentRows = await prisma.customerConsent.findMany({
      where: { tenant_id: tenantId, customer_id: customerId },
      orderBy: { sequence: 'asc' },
    });
    const events: LedgerEventSlice[] = consentRows.map((row) => ({
      purpose: row.purpose,
      channel: row.channel,
      status: row.status,
      sequence: row.sequence,
      basis: row.basis,
      text_version: row.text_version,
      text_snapshot: row.text_snapshot,
      evidence: row.evidence as LedgerEventSlice['evidence'],
    }));
    const decision = canContact({
      purpose: 'NEWSLETTER',
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

  it('rejects marketing GRANTED without consent wording', async () => {
    const prefs = await request(app.getHttpServer())
      .get(`/api/customers/${customerId}/communication-preferences`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/customers/${customerId}/communication-events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        controller_legal_entity_id: controllerId,
        expected_revision: prefs.body.revision,
        idempotency_key: `bad-grant-${Date.now()}`,
        channel: 'EMAIL',
        purpose: 'NEWSLETTER',
        status: 'GRANTED',
        basis: 'CONSENT',
        source: 'IMPORT',
      })
      .expect(400);
  });

  it('does not create communication state rows on preferences read alone', async () => {
    const fresh = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Read',
        last_name: 'Only',
        email: `aut589-read-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    await request(app.getHttpServer())
      .get(`/api/customers/${fresh.id}/communication-preferences`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const states = await prisma.customerCommunicationState.count({
      where: { tenant_id: tenantId, customer_id: fresh.id },
    });
    expect(states).toBe(0);
  });

  it('unsubscribe link withdraws again after a later grant', async () => {
    const fresh = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Unsub',
        last_name: 'Twice',
        email: `aut589-unsub-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const prefs = await request(app.getHttpServer())
      .get(`/api/customers/${fresh.id}/communication-preferences`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const grantBody = {
      controller_legal_entity_id: controllerId,
      channel: 'EMAIL',
      purpose: 'NEWSLETTER',
      status: 'GRANTED',
      basis: 'CONSENT',
      source: 'PROFILE',
      contact_address: 'unsub.twice@example.com',
      text_version: 'mkt-v1',
      text_snapshot: 'Marketing consent wording.',
    };

    await request(app.getHttpServer())
      .post(`/api/customers/${fresh.id}/communication-events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        ...grantBody,
        expected_revision: prefs.body.revision,
        idempotency_key: `grant-a-${Date.now()}`,
      })
      .expect(201);

    const token = mintUnsubscribeToken();
    await prisma.customerConsentUnsubscribeToken.create({
      data: {
        tenant_id: tenantId,
        controller_legal_entity_id: controllerId,
        customer_id: fresh.id,
        channel: 'EMAIL',
        contact_fingerprint: 'fp-test',
        token_sha256: token.sha256,
        retain_until: new Date('2099-01-01'),
      },
    });

    await request(app.getHttpServer())
      .post(`/api/public/consent-unsubscribe/${token.raw}`)
      .expect(200);

    const prefsAfterRevoke = await request(app.getHttpServer())
      .get(`/api/customers/${fresh.id}/communication-preferences`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/customers/${fresh.id}/communication-events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        ...grantBody,
        expected_revision: prefsAfterRevoke.body.revision,
        idempotency_key: `grant-b-${Date.now()}`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/public/consent-unsubscribe/${token.raw}`)
      .expect(200);

    const prefsFinal = await request(app.getHttpServer())
      .get(`/api/customers/${fresh.id}/communication-preferences`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const marketing = prefsFinal.body.preferences.find(
      (row: { purpose: string; channel: string }) =>
        row.purpose === 'NEWSLETTER' && row.channel === 'EMAIL',
    );
    expect(marketing.allowed).toBe(false);
  });

  it('records audit log entries for consent changes', async () => {
    const audit = await prisma.auditLog.findFirst({
      where: {
        tenant_id: tenantId,
        entity_type: 'CustomerConsent',
      },
      orderBy: { occurred_at: 'desc' },
    });
    expect(audit).toBeTruthy();
  });
});
