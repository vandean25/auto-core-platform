import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomerNoteRetentionClass } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { CustomerNoteRetentionService } from '../src/customer/notes/customer-note-retention.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

jest.setTimeout(30000);

describe('Customer notes & GDPR (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prismaA: PrismaService;
  let retentionService: CustomerNoteRetentionService;
  let tenantAId: string;
  let tenantBId: string;
  let salesTokenA: string;
  let ownerTokenA: string;
  let accountingTokenA: string;
  let tokenB: string;
  let customerAId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);
    retentionService = app.get<CustomerNoteRetentionService>(
      CustomerNoteRetentionService,
    );

    const tenantA = await createTestTenant(basePrisma, 'aut1040a');
    const tenantB = await createTestTenant(basePrisma, 'aut1040b');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    ownerTokenA = createTestAuthToken(authService, tenantA, { role: 'OWNER' });
    tokenB = createTestAuthToken(authService, tenantB, { role: 'ADMIN' });

    const salesUser = await basePrisma.user.create({
      data: {
        firebaseUid: `e2e-sales-${Date.now()}`,
        email: `sales-1040-${Date.now()}@example.com`,
      },
    });
    await seedTestTenantMember(basePrisma, {
      tenantId: tenantAId,
      userId: salesUser.id,
      role: 'SALES',
    });
    salesTokenA = createTestAuthToken(authService, tenantA, {
      sub: salesUser.firebaseUid ?? undefined,
      email: salesUser.email ?? undefined,
      role: 'SALES',
    });

    const accountingUser = await basePrisma.user.create({
      data: {
        firebaseUid: `e2e-acct-${Date.now()}`,
        email: `acct-1040-${Date.now()}@example.com`,
      },
    });
    await seedTestTenantMember(basePrisma, {
      tenantId: tenantAId,
      userId: accountingUser.id,
      role: 'ACCOUNTING',
    });
    accountingTokenA = createTestAuthToken(authService, tenantA, {
      sub: accountingUser.firebaseUid ?? undefined,
      email: accountingUser.email ?? undefined,
      role: 'ACCOUNTING',
    });

    prismaA = createTenantAwarePrisma(basePrisma, tenantAId);
    const customerA = await prismaA.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Clara',
        last_name: 'Notiz',
        email: `aut1040-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerAId = customerA.id;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantAId);
    await cleanupTestTenantGraph(basePrisma, tenantBId);
    await teardownTestApp(app);
  });

  it('Scenario 1: creates a note and exposes it on the customer file and in Verlauf as customer_note', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({
        body: 'First customer note',
        retention_class: CustomerNoteRetentionClass.CLAIMS_3Y,
        legal_hold: true,
      })
      .expect(201);

    expect(created.body.retention_class).toBe(
      CustomerNoteRetentionClass.OPERATIONAL,
    );
    expect(created.body.legal_hold).toBe(false);

    const listRes = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);
    expect(
      listRes.body.data.some((n: { id: string }) => n.id === created.body.id),
    ).toBe(true);

    const activityRes = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/activity?types=customer_note`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);
    expect(
      activityRes.body.data.some(
        (item: { type: string; ref_id: string }) =>
          item.type === 'customer_note' && item.ref_id === created.body.id,
      ),
    ).toBe(true);
  });

  it('Scenario 2: pinning a note places it at the top of the customer notes list', async () => {
    const first = await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: 'Pinned target note' })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: 'Second unpinned note' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/customers/${customerAId}/notes/${first.body.id}/pin`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ pinned: true })
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);

    expect(listRes.body.data[0].id).toBe(first.body.id);
    expect(listRes.body.data[0].pinned).toBe(true);
    expect(
      listRes.body.data.some((n: { id: string }) => n.id === second.body.id),
    ).toBe(true);
  });

  it('Scenario 4: Art 15 access package includes all customer notes with timestamps and author role', async () => {
    const art15Res = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/art15-export`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    expect(art15Res.body.customer_notes.length).toBeGreaterThanOrEqual(2);
    expect(art15Res.body.customer_notes[0]).toEqual(
      expect.objectContaining({
        author_role: 'SALES',
        created_at: expect.any(String),
        updated_at: expect.any(String),
      }),
    );
  });

  it('Scenario 5 & Anti-criterion 1: Art 20 portability export excludes all note text', async () => {
    const art20Res = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/art20-export`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    expect(art20Res.body.art20_subset).toBe(true);
    expect(art20Res.body).not.toHaveProperty('customer_notes');
    expect(JSON.stringify(art20Res.body)).not.toContain('First customer note');
    expect(JSON.stringify(art20Res.body)).not.toContain('Pinned target note');
  });

  it('Scenario 8 & Anti-criterion 2: deleting a note leaves at most body_sha256 and zero plaintext in audit_logs', async () => {
    const markerCreate = 'UNIQUE_MARKER_CREATE_9981';

    const created = await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: markerCreate })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/customers/${customerAId}/notes/${created.body.id}`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);

    const auditRows = await prismaA.auditLog.findMany({
      where: {
        tenant_id: tenantAId,
        entity_type: 'CustomerNote',
        entity_id: created.body.id,
      },
      orderBy: { occurred_at: 'asc' },
    });

    expect(auditRows.map((r) => r.action)).toEqual(['CREATE', 'DELETE']);
    const serialized = JSON.stringify(auditRows);
    expect(serialized).not.toContain(markerCreate);
    expect(serialized).toContain('body_sha256');
  });

  it('Scenario 10: editing a note records actor_role and occurred_at in audit_logs without plaintext', async () => {
    const markerBefore = 'UNIQUE_MARKER_BEFORE_1010';
    const markerEdit = 'UNIQUE_MARKER_EDIT_9982';

    const created = await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: markerBefore })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/customers/${customerAId}/notes/${created.body.id}`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: markerEdit })
      .expect(200);

    const updateRows = await prismaA.auditLog.findMany({
      where: {
        tenant_id: tenantAId,
        entity_type: 'CustomerNote',
        entity_id: created.body.id,
        action: 'UPDATE',
      },
    });

    expect(updateRows).toHaveLength(1);
    expect(updateRows[0].actor_role).toBe('SALES');
    expect(updateRows[0].occurred_at).toBeInstanceOf(Date);
    expect(JSON.stringify(updateRows)).not.toContain(markerEdit);
  });

  it('Scenario 9 & Anti-criterion 3: ACCOUNTING gets 403 on notes, sees no notes in detail/activity, but still sees non-note activity', async () => {
    const invoiceDate = new Date('2026-10-15T10:00:00.000Z');
    const invoice = await prismaA.invoice.create({
      data: {
        tenant_id: tenantAId,
        customer_id: customerAId,
        invoice_number: `RE-2026-ACCT-${Date.now()}`,
        status: 'FINALIZED',
        date: invoiceDate,
        due_date: invoiceDate,
        total_net: 100,
        total_tax: 20,
        total_gross: 120,
      },
    });

    await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${accountingTokenA}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${accountingTokenA}`)
      .send({ body: 'Should be forbidden' })
      .expect(403);

    const detailRes = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}`)
      .set('Authorization', `Bearer ${accountingTokenA}`)
      .expect(200);
    expect(JSON.stringify(detailRes.body)).not.toContain('First customer note');

    const activityRes = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/activity`)
      .set('Authorization', `Bearer ${accountingTokenA}`)
      .expect(200);
    expect(
      activityRes.body.data.filter(
        (item: { type: string }) => item.type === 'customer_note',
      ),
    ).toEqual([]);
    expect(
      activityRes.body.data.some(
        (item: { type: string; ref_id: string }) =>
          item.type === 'invoice' && item.ref_id === invoice.id,
      ),
    ).toBe(true);
  });

  it('Scenario 6: retention job deletes expired stand-alone notes, refreshes notes with recent activity, and preserves legal_hold notes', async () => {
    const expiredNote = await prismaA.customerNote.create({
      data: {
        tenant_id: tenantAId,
        customer_id: customerAId,
        body: 'Expired operational note',
        retention_class: CustomerNoteRetentionClass.OPERATIONAL,
        retain_until: new Date(Date.now() - 86_400_000),
        legal_hold: false,
      },
    });
    const heldNote = await prismaA.customerNote.create({
      data: {
        tenant_id: tenantAId,
        customer_id: customerAId,
        body: 'Legal hold note',
        retention_class: CustomerNoteRetentionClass.OPERATIONAL,
        retain_until: new Date(Date.now() - 86_400_000),
        legal_hold: true,
      },
    });

    // customerAId has the 2026-10-15 invoice from Scenario 9, so operational notes are refreshed instead of purged
    const ran = await retentionService.run();
    expect(ran).toBe(true);

    const refreshed = await prismaA.customerNote.findFirst({
      where: { id: expiredNote.id, tenant_id: tenantAId },
    });
    expect(refreshed).not.toBeNull();
    expect(refreshed!.retain_until.getUTCFullYear()).toBe(2029);

    // A customer without recent activity has expired operational notes purged
    const inactiveCustomer = await prismaA.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Inaktiv',
        last_name: 'Kunde',
        type: 'PRIVATE',
      },
    });
    const trulyExpired = await prismaA.customerNote.create({
      data: {
        tenant_id: tenantAId,
        customer_id: inactiveCustomer.id,
        body: 'Truly expired operational note',
        retention_class: CustomerNoteRetentionClass.OPERATIONAL,
        retain_until: new Date(Date.now() - 86_400_000),
        legal_hold: false,
      },
    });

    await retentionService.run();
    const afterPurge = await prismaA.customerNote.findFirst({
      where: { id: trulyExpired.id, tenant_id: tenantAId },
    });
    const heldAfter = await prismaA.customerNote.findFirst({
      where: { id: heldNote.id, tenant_id: tenantAId },
    });
    expect(afterPurge).toBeNull();
    expect(heldAfter).not.toBeNull();
  });

  it('Scenario 7 & tenant isolation: tenant B cannot read notes, erasure deletes unprotected notes and restricts CLAIMS_3Y working copy', async () => {
    await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    const finalizedInvoice = await prismaA.invoice.findFirst({
      where: { tenant_id: tenantAId, customer_id: customerAId },
      orderBy: { date: 'desc' },
    });
    const claimsNote = await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({
        body: 'Claims note tied to invoice',
        pinned: true,
        invoice_id: finalizedInvoice!.id,
      })
      .expect(201);

    expect(claimsNote.body.retention_class).toBe(
      CustomerNoteRetentionClass.CLAIMS_3Y,
    );
    expect(claimsNote.body.legal_hold).toBe(true);
    expect(new Date(claimsNote.body.retain_until).getUTCFullYear()).toBe(
      finalizedInvoice!.date.getUTCFullYear() + 3,
    );

    await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/erase`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(201);

    const remainingOperational = await prismaA.customerNote.findMany({
      where: {
        tenant_id: tenantAId,
        customer_id: customerAId,
        legal_hold: false,
        retention_class: CustomerNoteRetentionClass.OPERATIONAL,
      },
    });
    expect(remainingOperational).toEqual([]);

    const listAfterErase = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);
    expect(listAfterErase.body.data).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/api/customers/${customerAId}/notes/${claimsNote.body.id}`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: 'Cannot edit restricted' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/customers/${customerAId}/notes/${claimsNote.body.id}/pin`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ pinned: true })
      .expect(403);

    const art15AfterErase = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/art15-export`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    expect(
      art15AfterErase.body.customer_notes.some(
        (n: { id: string; body: string; erasure_restricted: boolean }) =>
          n.id === claimsNote.body.id &&
          n.body === 'Claims note tied to invoice' &&
          n.erasure_restricted === true,
      ),
    ).toBe(true);
  });
});
