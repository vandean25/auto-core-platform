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

  it('Scenario 1 & 2: creates notes, pins a note to top, and exposes notes in Verlauf as customer_note', async () => {
    const first = await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: 'First customer note' })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: 'Second customer note' })
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
    expect(listRes.body.data[1].id).toBe(second.body.id);

    const activityRes = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/activity?types=customer_note`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);

    expect(
      activityRes.body.data.some(
        (item: { type: string; ref_id: string }) =>
          item.type === 'customer_note' && item.ref_id === first.body.id,
      ),
    ).toBe(true);
  });

  it('Scenario 9 & Anti-criterion 3: ACCOUNTING role gets 403 on notes and sees no notes in detail or activity', async () => {
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
  });

  it('Scenario 4, 5 & Anti-criterion 1: Art 15 includes notes with role/timestamps; Art 20 excludes all note text', async () => {
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

    const art20Res = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/art20-export`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    expect(art20Res.body.art20_subset).toBe(true);
    expect(art20Res.body).not.toHaveProperty('customer_notes');
    expect(JSON.stringify(art20Res.body)).not.toContain('First customer note');
    expect(JSON.stringify(art20Res.body)).not.toContain('Second customer note');
  });

  it('Scenario 8, 10 & Anti-criterion 2: edit and delete record audit without leaving note text in audit_logs', async () => {
    const markerCreate = 'UNIQUE_MARKER_CREATE_9981';
    const markerEdit = 'UNIQUE_MARKER_EDIT_9982';

    const created = await request(app.getHttpServer())
      .post(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: markerCreate })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/customers/${customerAId}/notes/${created.body.id}`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .send({ body: markerEdit })
      .expect(200);

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

    expect(auditRows.map((r) => r.action)).toEqual([
      'CREATE',
      'UPDATE',
      'DELETE',
    ]);
    for (const row of auditRows) {
      expect(row.actor_role).toBe('SALES');
      expect(row.occurred_at).toBeInstanceOf(Date);
    }

    const serialized = JSON.stringify(auditRows);
    expect(serialized).not.toContain(markerCreate);
    expect(serialized).not.toContain(markerEdit);
    expect(serialized).toContain('body_sha256');
  });

  it('Scenario 6: retention job deletes expired stand-alone notes and preserves legal_hold notes', async () => {
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

    const ran = await retentionService.run();
    expect(ran).toBe(true);

    const expiredAfter = await prismaA.customerNote.findFirst({
      where: { id: expiredNote.id, tenant_id: tenantAId },
    });
    const heldAfter = await prismaA.customerNote.findFirst({
      where: { id: heldNote.id, tenant_id: tenantAId },
    });
    expect(expiredAfter).toBeNull();
    expect(heldAfter).not.toBeNull();
  });

  it('Scenario 7 & tenant isolation: tenant B cannot read notes, and erasure deletes unprotected notes', async () => {
    await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/notes`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

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
  });
});
