import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  seedTestEmployee,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Workshop order notes undo (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let siteId: string;
  let firebaseUid: string;
  let authToken: string;
  let techToken: string;
  let customerId: string;

  const api = () => request(app.getHttpServer());

  async function createIntakeOrder() {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        make: 'VW',
        model: 'Polo',
        year: 2020,
        vin: `VIN-NOTES-UNDO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
    });
    const res = await api()
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId: vehicle.id,
        odometer: 12000,
        fuelLevel: 50,
      })
      .expect(201);
    return res.body as { id: string; notes: string | null; updatedAt: string };
  }

  async function patchNotes(
    orderId: string,
    notes: string,
    token = authToken,
  ) {
    const res = await api()
      .patch(`/api/workshop/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes })
      .expect(200);
    return res.body as { id: string; notes: string | null; updatedAt: string };
  }

  function undoNotes(
    orderId: string,
    body: { previousNotes: string | null; expectedUpdatedAt: string },
    token = authToken,
  ) {
    return api()
      .post(`/api/workshop/orders/${orderId}/notes/undo`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  beforeAll(async () => {
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'wo-notes-undo');
    tenantId = testTenant.tenantId;
    firebaseUid = testTenant.firebaseUid;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    siteId = await resolveTestMainSiteId(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    const techUid = `wo-notes-undo-tech-${tenantId}`;
    const techUser = await prisma.user.create({
      data: {
        firebaseUid: techUid,
        email: `${techUid}@test.local`,
        active_tenant_id: tenantId,
        active_site_id: siteId,
      },
    });
    await seedTestTenantMember(basePrisma, {
      tenantId,
      userId: techUser.id,
      role: 'TECH',
    });
    await prisma.siteMembership.create({
      data: {
        tenant_id: tenantId,
        user_id: techUser.id,
        site_id: siteId,
        is_active: true,
      },
    });
    await seedTestEmployee(prisma, {
      tenantId,
      name: 'Undo E2E Tech',
      role: 'MECHANIC',
      userId: techUser.id,
    });
    techToken = app.get(AuthService).createTestToken({
      sub: techUid,
      email: techUser.email,
      tenantId,
      role: 'TECH',
    });

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Notes',
        last_name: 'Undo',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('restores previous notes when expectedUpdatedAt still matches', async () => {
    const order = await createIntakeOrder();
    const updated = await patchNotes(order.id, 'After edit');
    expect(updated.notes).toBe('After edit');

    const undoRes = await undoNotes(order.id, {
      previousNotes: order.notes,
      expectedUpdatedAt: updated.updatedAt,
    }).expect(201);

    expect(undoRes.body.notes).toBe(order.notes);
    const row = await prisma.workshopOrder.findFirstOrThrow({
      where: { id: order.id },
      select: { notes: true },
    });
    expect(row.notes).toBe(order.notes);
  });

  it('returns 409 on a second undo with the same expected version', async () => {
    const order = await createIntakeOrder();
    const updated = await patchNotes(order.id, 'Once');
    const dto = {
      previousNotes: order.notes,
      expectedUpdatedAt: updated.updatedAt,
    };

    await undoNotes(order.id, dto).expect(201);
    const second = await undoNotes(order.id, dto).expect(409);
    expect(second.body.message).toMatch(/concurrently|Undo is no longer available/i);
  });

  it('returns 409 without overwriting when another edit changed updatedAt', async () => {
    const order = await createIntakeOrder();
    const firstEdit = await patchNotes(order.id, 'Version A');
    const staleExpectedAt = firstEdit.updatedAt;

    await patchNotes(order.id, 'Version B');
    const conflict = await undoNotes(order.id, {
      previousNotes: order.notes,
      expectedUpdatedAt: staleExpectedAt,
    }).expect(409);

    expect(conflict.body.message).toMatch(/concurrently|Undo is no longer available/i);
    const row = await prisma.workshopOrder.findFirstOrThrow({
      where: { id: order.id },
      select: { notes: true },
    });
    expect(row.notes).toBe('Version B');
  });

  it('returns 409 when a later edit sets notes back without matching updatedAt', async () => {
    const order = await createIntakeOrder();
    const originalNotes = 'Original note text';
    await patchNotes(order.id, originalNotes);
    const edited = await patchNotes(order.id, 'Changed');
    const staleExpectedAt = edited.updatedAt;

    await patchNotes(order.id, originalNotes);
    const conflict = await undoNotes(order.id, {
      previousNotes: 'Before edit',
      expectedUpdatedAt: staleExpectedAt,
    }).expect(409);

    expect(conflict.body.message).toMatch(/concurrently|Undo is no longer available/i);
    const row = await prisma.workshopOrder.findFirstOrThrow({
      where: { id: order.id },
      select: { notes: true },
    });
    expect(row.notes).toBe(originalNotes);
  });

  it('returns 403 for TECH on the undo route', async () => {
    const order = await createIntakeOrder();
    const updated = await patchNotes(order.id, 'Advisor edit');

    await undoNotes(
      order.id,
      {
        previousNotes: order.notes,
        expectedUpdatedAt: updated.updatedAt,
      },
      techToken,
    ).expect(403);
  });

  it('returns 404 when the order belongs to another active site', async () => {
    const order = await createIntakeOrder();
    const updated = await patchNotes(order.id, 'Site scoped');

    const siteB = await prisma.site.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: (
          await prisma.site.findFirstOrThrow({
            where: { id: siteId },
            select: { legal_entity_id: true },
          })
        ).legal_entity_id,
        code: `UNDO-SITE-${Date.now()}`,
        name: `Undo second site ${Date.now()}`,
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: true,
      },
    });
    const user = await basePrisma.user.findUniqueOrThrow({
      where: { firebaseUid },
      select: { id: true },
    });
    await prisma.siteMembership.create({
      data: {
        tenant_id: tenantId,
        user_id: user.id,
        site_id: siteB.id,
        is_active: true,
      },
    });

    await basePrisma.user.update({
      where: { id: user.id },
      data: { active_site_id: siteB.id },
    });

    try {
      await undoNotes(order.id, {
        previousNotes: order.notes,
        expectedUpdatedAt: updated.updatedAt,
      }).expect(404);
    } finally {
      await basePrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: siteId },
      });
    }
  });
});
