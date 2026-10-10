import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe, GlobalExceptionFilter } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

type OrderFixture = {
  orderId: string;
  laborLineId: string;
  partLineId: string;
  cancelledPartLineId: string;
};

const MISSING_CLAIM_ID = '00000000-0000-4000-8000-000000000000';

function claimsPath(orderId: string, claimId?: string): string {
  const base = `/api/workshop/orders/${orderId}/warranty-claims`;
  return claimId ? `${base}/${claimId}` : base;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/** Plain text of every page, read the same way the invoice render fixtures read theirs. */
async function readPdfText(pdfBytes: Buffer): Promise<string> {
  const loadingTask = getDocument({ data: new Uint8Array(pdfBytes) });
  const document = await loadingTask.promise;
  const pages = await Promise.all(
    Array.from({ length: document.numPages }, async (_, index) => {
      const page = await document.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join(' ');
    }),
  );
  await loadingTask.destroy();
  return pages.join(' ');
}

describe('Warranty claims (AUT-464, e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  let prisma: PrismaService;
  let siteId: string;
  let adminUserId: string;
  let adminToken: string;
  const extraTenantIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    basePrisma = app.get(PrismaService);
    authService = app.get(AuthService);
  });

  beforeEach(async () => {
    tenant = await createTestTenant(basePrisma, 'warranty-claims');
    prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    adminToken = createTestAuthToken(authService, tenant);
    siteId = await resolveTestMainSiteId(basePrisma, tenant.tenantId);
    const admin = await basePrisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    adminUserId = admin.id;
  });

  afterEach(async () => {
    await cleanupTestTenantGraph(basePrisma, tenant.tenantId).catch(() => undefined);
    for (const tenantId of extraTenantIds.splice(0)) {
      await cleanupTestTenantGraph(basePrisma, tenantId).catch(() => undefined);
    }
  });

  afterAll(async () => {
    await teardownTestApp(app, basePrisma);
  });

  async function seedOrder(
    options: { status?: 'INTAKE' | 'SCHEDULED'; siteId?: string } = {},
  ): Promise<OrderFixture> {
    const suffix = uniqueSuffix();
    const customer = await prisma.customer.create({
      data: { first_name: 'Demo', last_name: 'Kunde', type: 'PRIVATE' },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        customer_id: customer.id,
        make: 'Demo',
        model: 'Roadster',
        year: 2021,
        vin: `DEMO${randomUUID().replace(/-/g, '').slice(0, 13)}`.toUpperCase(),
        plate: 'W-DEMO-1',
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        site_id: options.siteId ?? siteId,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        order_number: `WO-AUT464-${suffix}`,
        status: options.status ?? 'INTAKE',
        odometer: 84210,
        fuel_level: 50,
      },
    });
    const task = await prisma.workshopTask.create({
      data: { workshop_order_id: order.id, title: 'Kupplung prüfen' },
    });
    const laborLine = await prisma.workshopTaskLineItem.create({
      data: {
        workshop_task_id: task.id,
        type: 'LABOR',
        item_no: 'LAB-KUPPLUNG',
        description: 'Kupplung entlüften',
        quantity: 2.5,
        unit_price: 100,
      },
    });
    const partLine = await prisma.workshopTaskLineItem.create({
      data: {
        workshop_task_id: task.id,
        type: 'PART',
        item_no: 'A1234567',
        description: 'Geberzylinder',
        quantity: 1,
        unit_price: 1000,
        part_execution_status: 'PENDING_PICK',
      },
    });
    const cancelledPartLine = await prisma.workshopTaskLineItem.create({
      data: {
        workshop_task_id: task.id,
        type: 'PART',
        item_no: 'B7654321',
        description: 'Dichtsatz (storniert)',
        quantity: 1,
        unit_price: 30,
        part_execution_status: 'CANCELLED',
      },
    });
    return {
      orderId: order.id,
      laborLineId: laborLine.id,
      partLineId: partLine.id,
      cancelledPartLineId: cancelledPartLine.id,
    };
  }

  /** A part line of an order that belongs to a different tenant. */
  async function seedForeignPartLine(): Promise<string> {
    const foreign = await createTestTenant(basePrisma, 'warranty-foreign');
    extraTenantIds.push(foreign.tenantId);
    const foreignPrisma = createTenantAwarePrisma(basePrisma, foreign.tenantId);
    const foreignSiteId = await resolveTestMainSiteId(basePrisma, foreign.tenantId);
    const customer = await foreignPrisma.customer.create({
      data: { first_name: 'Demo', last_name: 'Fremd', type: 'PRIVATE' },
    });
    const vehicle = await foreignPrisma.vehicle.create({
      data: {
        customer_id: customer.id,
        make: 'Demo',
        model: 'Roadster',
        year: 2021,
        vin: `DEMO${randomUUID().replace(/-/g, '').slice(0, 13)}`.toUpperCase(),
        plate: 'W-FREMD-1',
      },
    });
    const order = await foreignPrisma.workshopOrder.create({
      data: {
        site_id: foreignSiteId,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        order_number: `WO-FREMD-${uniqueSuffix()}`,
        status: 'INTAKE',
        odometer: 1000,
        fuel_level: 50,
      },
    });
    const task = await foreignPrisma.workshopTask.create({
      data: { workshop_order_id: order.id, title: 'Fremde Aufgabe' },
    });
    const line = await foreignPrisma.workshopTaskLineItem.create({
      data: {
        workshop_task_id: task.id,
        type: 'PART',
        item_no: 'FREMD-1',
        description: 'Fremdteil',
        quantity: 1,
        unit_price: 10,
        part_execution_status: 'PENDING_PICK',
      },
    });
    return line.id;
  }

  async function createMemberToken(role: 'OWNER' | 'SALES' | 'TECH'): Promise<string> {
    const uid = `warranty-${role.toLowerCase()}-${uniqueSuffix()}`;
    const email = `${uid}@test.local`;
    const user = await basePrisma.user.create({ data: { firebaseUid: uid, email } });
    await seedTestTenantMember(basePrisma, { tenantId: tenant.tenantId, userId: user.id, role });
    await prisma.siteMembership.create({
      data: { tenant_id: tenant.tenantId, user_id: user.id, site_id: siteId, is_active: true },
    });
    await basePrisma.user.update({ where: { id: user.id }, data: { active_site_id: siteId } });
    return authService.createTestToken({ sub: uid, email, tenantId: tenant.tenantId, role });
  }

  async function createClaim(
    orderId: string,
    body: Record<string, unknown> = {},
    token = adminToken,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(claimsPath(orderId))
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'KULANZ', ...body })
      .expect(201);
    return response.body.id as string;
  }

  async function patchClaim(
    orderId: string,
    claimId: string,
    body: Record<string, unknown>,
    expectedStatus = 200,
  ) {
    return request(app.getHttpServer())
      .patch(claimsPath(orderId, claimId))
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(expectedStatus);
  }

  /**
   * Holds a row lock in its own transaction until the returned function is called. Saves that need the
   * row queue behind it, so a test can check that they really wait instead of relying on request timing.
   */
  async function holdRowLock(
    lock: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<() => Promise<void>> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = basePrisma.$transaction(
      async (tx) => {
        await lock(tx);
        acquired();
        await released;
      },
      { timeout: 30_000 },
    );
    await Promise.race([lockTaken, holder]);
    return async () => {
      release();
      await holder;
    };
  }

  async function auditEntries(claimId: string) {
    return prisma.auditLog.findMany({
      where: { tenant_id: tenant.tenantId, entity_type: 'WarrantyClaim', entity_id: claimId },
      orderBy: { occurred_at: 'asc' },
    });
  }

  async function updatedAtOf(claimId: string): Promise<Date | undefined> {
    const row = await prisma.warrantyClaim.findFirst({
      where: { id: claimId, tenant_id: tenant.tenantId },
      select: { updatedAt: true },
    });
    return row?.updatedAt;
  }

  function completeClaimBody(fixture: OrderFixture) {
    return {
      complaint: 'Kupplung rutscht bei Kaltstart',
      causeCorrection: 'Geberzylinder getauscht',
      claimedAmountNet: 1250,
      lineItemIds: [fixture.laborLineId, fixture.partLineId],
    };
  }

  describe('create and read', () => {
    it('creates a DRAFT claim with line snapshots and EUR amounts, and audits the creation', async () => {
      const fixture = await seedOrder();

      const response = await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'KULANZ', ...completeClaimBody(fixture) })
        .expect(201);

      expect(response.body).toMatchObject({
        workshopOrderId: fixture.orderId,
        type: 'KULANZ',
        status: 'DRAFT',
        claimedAmountNet: '1250.00',
        linesNetAmount: '1250.00',
        submittedAt: null,
      });
      const lines = response.body.lines as Array<Record<string, string>>;
      expect(lines).toHaveLength(2);
      expect(lines.find((line) => line.itemNo === 'LAB-KUPPLUNG')).toMatchObject({
        lineType: 'LABOR',
        quantity: '2.500',
        unitPrice: '100.00',
        netAmount: '250.00',
      });
      expect(lines.find((line) => line.itemNo === 'A1234567')).toMatchObject({
        lineType: 'PART',
        netAmount: '1000.00',
      });

      const entries = await auditEntries(response.body.id as string);
      expect(entries.map((entry) => entry.action)).toEqual(['CREATE']);
      expect(entries[0]).toMatchObject({ actor_role: 'ADMIN', actor_type: 'USER' });
    });

    it('lists the claims of one order and filters them by status', async () => {
      const fixture = await seedOrder();
      await createClaim(fixture.orderId, { type: 'GARANTIE' });
      const submittedId = await createClaim(fixture.orderId, completeClaimBody(fixture));
      await patchClaim(fixture.orderId, submittedId, { status: 'SUBMITTED_EXTERNALLY' });

      const all = await request(app.getHttpServer())
        .get(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(all.body.meta.total).toBe(2);
      expect(all.body.data).toHaveLength(2);

      const submitted = await request(app.getHttpServer())
        .get(claimsPath(fixture.orderId))
        .query({ status: 'SUBMITTED_EXTERNALLY' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(submitted.body.data.map((claim: { id: string }) => claim.id)).toEqual([submittedId]);

      const drafts = await request(app.getHttpServer())
        .get(claimsPath(fixture.orderId))
        .query({ status: 'DRAFT,APPROVED' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(drafts.body.meta.total).toBe(1);

      await request(app.getHttpServer())
        .get(claimsPath(fixture.orderId))
        .query({ status: 'PAID' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('returns 404 for a claim id that does not exist on the order', async () => {
      const fixture = await seedOrder();
      await request(app.getHttpServer())
        .get(claimsPath(fixture.orderId, MISSING_CLAIM_ID))
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('refuses to file a claim on a SCHEDULED order', async () => {
      const fixture = await seedOrder({ status: 'SCHEDULED' });
      const response = await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'GARANTIE' })
        .expect(422);
      expect(response.body.code).toBe('WARRANTY_CLAIM_ORDER_NOT_CHECKED_IN');
    });
  });

  describe('editing and status', () => {
    it('edits a DRAFT claim and records the change with its diff', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, { complaint: 'alt' });

      const updated = await patchClaim(fixture.orderId, claimId, {
        complaint: '  Neue Beschreibung  ',
        claimedAmountNet: 99.5,
      });
      expect(updated.body).toMatchObject({ complaint: 'Neue Beschreibung', claimedAmountNet: '99.50' });

      const entries = await auditEntries(claimId);
      expect(entries.map((entry) => entry.action)).toEqual(['CREATE', 'UPDATE']);
      expect(entries[1].diff).toMatchObject({
        complaint: { from: 'alt', to: 'Neue Beschreibung' },
        claimedAmountNet: { from: null, to: '99.50' },
      });
    });

    it('leaves updatedAt and the audit trail alone when a save changes nothing', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, { complaint: 'alt' });
      const before = await prisma.warrantyClaim.findFirst({
        where: { id: claimId, tenant_id: tenant.tenantId },
        select: { updatedAt: true },
      });

      const response = await patchClaim(fixture.orderId, claimId, { complaint: 'alt' });
      expect(response.body).toMatchObject({ complaint: 'alt' });

      const after = await prisma.warrantyClaim.findFirst({
        where: { id: claimId, tenant_id: tenant.tenantId },
        select: { updatedAt: true },
      });
      expect(after?.updatedAt).toEqual(before?.updatedAt);
      expect((await auditEntries(claimId)).map((entry) => entry.action)).toEqual(['CREATE']);
    });

    it('leaves updatedAt alone when the same lines in another order and the same reference are sent', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, {
        lineItemIds: [fixture.laborLineId, fixture.partLineId],
      });
      await patchClaim(fixture.orderId, claimId, { externalReference: 'OEM-1' });
      const before = await updatedAtOf(claimId);

      await patchClaim(fixture.orderId, claimId, {
        lineItemIds: [fixture.partLineId, fixture.laborLineId],
        externalReference: 'OEM-1',
      });

      expect(await updatedAtOf(claimId)).toEqual(before);
      expect((await auditEntries(claimId)).map((entry) => entry.action)).toEqual(['CREATE', 'UPDATE']);
    });

    it('will not submit a claim that is missing its complaint, amount or lines', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId);

      const response = await patchClaim(
        fixture.orderId,
        claimId,
        { status: 'SUBMITTED_EXTERNALLY' },
        422,
      );
      expect(response.body).toMatchObject({
        code: 'WARRANTY_CLAIM_SUBMISSION_INCOMPLETE',
        message: expect.stringMatching(/complaint.*claimed amount.*affected line/),
      });
    });

    it('locks the content after submission but keeps the external reference editable', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, completeClaimBody(fixture));

      const submitted = await patchClaim(fixture.orderId, claimId, { status: 'SUBMITTED_EXTERNALLY' });
      expect(submitted.body.status).toBe('SUBMITTED_EXTERNALLY');
      expect(submitted.body.submittedAt).toEqual(expect.any(String));

      const locked = await patchClaim(fixture.orderId, claimId, { complaint: 'Nachtrag' }, 409);
      expect(locked.body.code).toBe('WARRANTY_CLAIM_LOCKED');

      // Re-sending unchanged content is not a change, so it is accepted.
      await patchClaim(fixture.orderId, claimId, { complaint: 'Kupplung rutscht bei Kaltstart' });

      const reference = await patchClaim(fixture.orderId, claimId, { externalReference: 'OEM-REF-77' });
      expect(reference.body.externalReference).toBe('OEM-REF-77');
    });

    it('requires a decision date to approve, and rejects impossible transitions', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, completeClaimBody(fixture));
      await patchClaim(fixture.orderId, claimId, { status: 'SUBMITTED_EXTERNALLY' });

      const missingDate = await patchClaim(fixture.orderId, claimId, { status: 'APPROVED' }, 422);
      expect(missingDate.body.code).toBe('WARRANTY_CLAIM_DECISION_DATE_REQUIRED');

      const impossibleDay = await patchClaim(
        fixture.orderId,
        claimId,
        { status: 'APPROVED', decisionDate: '2026-02-30' },
        422,
      );
      expect(impossibleDay.body.message).toContain('Invalid calendar day');

      const approved = await patchClaim(fixture.orderId, claimId, {
        status: 'APPROVED',
        decisionDate: '2026-10-10',
        decisionNote: 'Kulanz bewilligt, 80 % Anteil',
      });
      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        decisionDate: '2026-10-10',
        decisionNote: 'Kulanz bewilligt, 80 % Anteil',
      });

      const backwards = await patchClaim(fixture.orderId, claimId, { status: 'SUBMITTED_EXTERNALLY' }, 409);
      expect(backwards.body.code).toBe('WARRANTY_CLAIM_INVALID_TRANSITION');
    });

    it('closes a claim, after which it is read-only, and audits every status change', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, completeClaimBody(fixture));
      await patchClaim(fixture.orderId, claimId, { status: 'SUBMITTED_EXTERNALLY' });
      await patchClaim(fixture.orderId, claimId, {
        status: 'REJECTED',
        decisionDate: '2026-10-09',
      });

      const closed = await patchClaim(fixture.orderId, claimId, { status: 'CLOSED' });
      expect(closed.body.status).toBe('CLOSED');
      expect(closed.body.closedAt).toEqual(expect.any(String));

      const frozen = await patchClaim(fixture.orderId, claimId, { externalReference: 'zu spät' }, 409);
      expect(frozen.body.code).toBe('WARRANTY_CLAIM_CLOSED');

      const entries = await auditEntries(claimId);
      const statusChanges = entries
        .map((entry) => entry.diff as Record<string, { from: string; to: string }> | null)
        .filter((diff): diff is Record<string, { from: string; to: string }> => Boolean(diff?.status))
        .map((diff) => `${diff.status.from}->${diff.status.to}`);
      expect(statusChanges).toEqual([
        'DRAFT->SUBMITTED_EXTERNALLY',
        'SUBMITTED_EXTERNALLY->REJECTED',
        'REJECTED->CLOSED',
      ]);
    });
  });

  describe('affected lines', () => {
    it('rejects a line from another workshop order', async () => {
      const fixture = await seedOrder();
      const other = await seedOrder();

      const response = await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'KULANZ', lineItemIds: [other.partLineId] })
        .expect(422);
      expect(response.body.code).toBe('WARRANTY_CLAIM_LINE_NOT_ON_ORDER');
    });

    it('rejects a cancelled part line', async () => {
      const fixture = await seedOrder();
      const response = await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'KULANZ', lineItemIds: [fixture.cancelledPartLineId] })
        .expect(422);
      expect(response.body.code).toBe('WARRANTY_CLAIM_LINE_CANCELLED');
    });

    it('keeps a line on one open claim at a time, and frees it when that claim is closed', async () => {
      const fixture = await seedOrder();
      const firstId = await createClaim(fixture.orderId, { lineItemIds: [fixture.partLineId] });

      const clash = await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'GARANTIE', lineItemIds: [fixture.partLineId] })
        .expect(409);
      expect(clash.body.code).toBe('WARRANTY_CLAIM_LINE_ALREADY_CLAIMED');

      await patchClaim(fixture.orderId, firstId, { status: 'CLOSED' });

      await createClaim(fixture.orderId, { type: 'GARANTIE', lineItemIds: [fixture.partLineId] });
    });

    it('replaces the line set of a DRAFT claim and recalculates the total', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, { lineItemIds: [fixture.laborLineId, fixture.partLineId] });

      const replaced = await patchClaim(fixture.orderId, claimId, { lineItemIds: [fixture.partLineId] });
      expect(replaced.body.lines).toHaveLength(1);
      expect(replaced.body.linesNetAmount).toBe('1000.00');
    });

    it('refuses a null line set, which would otherwise clear every line of a DRAFT claim', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, {
        lineItemIds: [fixture.laborLineId, fixture.partLineId],
      });

      await patchClaim(fixture.orderId, claimId, { lineItemIds: null }, 400);
      await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'KULANZ', lineItemIds: null })
        .expect(400);

      const kept = await request(app.getHttpServer())
        .get(claimsPath(fixture.orderId, claimId))
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(kept.body.lines).toHaveLength(2);
    });
  });

  describe('roles and isolation', () => {
    it('lets the workshop advisor (SALES) work claims, and keeps mechanics (TECH) out', async () => {
      const fixture = await seedOrder();
      const advisorToken = await createMemberToken('SALES');
      const mechanicToken = await createMemberToken('TECH');

      await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${advisorToken}`)
        .send({ type: 'GARANTIE', complaint: 'Geräusch' })
        .expect(201);

      await request(app.getHttpServer())
        .get(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${mechanicToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${mechanicToken}`)
        .send({ type: 'GARANTIE' })
        .expect(403);
    });

    it('does not expose claims of another tenant, not even by id', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, completeClaimBody(fixture));

      const other = await createTestTenant(basePrisma, 'warranty-other');
      try {
        const otherToken = createTestAuthToken(authService, other);

        await request(app.getHttpServer())
          .get(claimsPath(fixture.orderId))
          .set('Authorization', `Bearer ${otherToken}`)
          .expect(404);
        await request(app.getHttpServer())
          .get(claimsPath(fixture.orderId, claimId))
          .set('Authorization', `Bearer ${otherToken}`)
          .expect(404);
        await request(app.getHttpServer())
          .patch(claimsPath(fixture.orderId, claimId))
          .set('Authorization', `Bearer ${otherToken}`)
          .send({ complaint: 'manipuliert' })
          .expect(404);
        await request(app.getHttpServer())
          .get(`${claimsPath(fixture.orderId, claimId)}/pdf`)
          .set('Authorization', `Bearer ${otherToken}`)
          .expect(404);

        const unchanged = await prisma.warrantyClaim.findFirstOrThrow({
          where: { id: claimId, tenant_id: tenant.tenantId },
          select: { complaint: true },
        });
        expect(unchanged.complaint).toBe('Kupplung rutscht bei Kaltstart');
      } finally {
        await cleanupTestTenantGraph(basePrisma, other.tenantId).catch(() => undefined);
      }
    });

    it('hides claims of an order that belongs to another site of the same tenant', async () => {
      const legalEntity = await prisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenant.tenantId },
      });
      const westSite = await prisma.site.create({
        data: {
          tenant_id: tenant.tenantId,
          legal_entity_id: legalEntity.id,
          code: 'WEST',
          name: 'West site',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
        },
      });
      await prisma.siteMembership.create({
        data: { tenant_id: tenant.tenantId, user_id: adminUserId, site_id: westSite.id, is_active: true },
      });
      const westOrder = await seedOrder({ siteId: westSite.id });

      await basePrisma.user.update({ where: { id: adminUserId }, data: { active_site_id: westSite.id } });
      const westClaimId = await createClaim(westOrder.orderId, { type: 'GARANTIE' });

      await basePrisma.user.update({ where: { id: adminUserId }, data: { active_site_id: siteId } });
      await request(app.getHttpServer())
        .get(claimsPath(westOrder.orderId, westClaimId))
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(claimsPath(westOrder.orderId))
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      await basePrisma.user.update({ where: { id: adminUserId }, data: { active_site_id: westSite.id } });
      await request(app.getHttpServer())
        .get(claimsPath(westOrder.orderId, westClaimId))
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('line sync, concurrency and task deletion', () => {
    it('keeps the snapshot of a line that stays on the claim when the line set changes', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, { lineItemIds: [fixture.partLineId] });
      await prisma.workshopTaskLineItem.updateMany({
        where: { id: fixture.partLineId },
        data: { unit_price: 1200 },
      });

      const response = await patchClaim(fixture.orderId, claimId, {
        lineItemIds: [fixture.partLineId, fixture.laborLineId],
      });

      const lines = response.body.lines as Array<Record<string, string>>;
      expect(lines.find((line) => line.workshopTaskLineItemId === fixture.partLineId)).toMatchObject({
        unitPrice: '1000.00',
        netAmount: '1000.00',
      });
      expect(lines.find((line) => line.workshopTaskLineItemId === fixture.laborLineId)).toMatchObject({
        netAmount: '250.00',
      });
    });

    it('audits a change of the line set as a diff of the lines', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, completeClaimBody(fixture));

      await patchClaim(fixture.orderId, claimId, { lineItemIds: [fixture.partLineId] });

      const entries = await auditEntries(claimId);
      expect(entries.map((entry) => entry.action)).toEqual(['CREATE', 'UPDATE']);
      expect(entries[1].diff).toHaveProperty('lines');
    });

    it('locks the line set once the claim is submitted', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, completeClaimBody(fixture));
      await patchClaim(fixture.orderId, claimId, { status: 'SUBMITTED_EXTERNALLY' });

      const response = await patchClaim(
        fixture.orderId,
        claimId,
        { lineItemIds: [fixture.partLineId] },
        409,
      );
      expect(response.body.code).toBe('WARRANTY_CLAIM_LOCKED');
    });

    it('keeps a cancelled line that stays on the claim, but will not submit with it', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, { lineItemIds: [fixture.partLineId] });
      await prisma.workshopTaskLineItem.updateMany({
        where: { id: fixture.partLineId },
        data: { part_execution_status: 'CANCELLED' },
      });

      // Only added lines are checked, so the cancelled line does not block this save.
      await patchClaim(fixture.orderId, claimId, {
        complaint: 'Kupplung rutscht',
        claimedAmountNet: 1000,
        lineItemIds: [fixture.partLineId, fixture.laborLineId],
      });

      const response = await patchClaim(
        fixture.orderId,
        claimId,
        { status: 'SUBMITTED_EXTERNALLY' },
        422,
      );
      expect(response.body.code).toBe('WARRANTY_CLAIM_LINE_CANCELLED');
    });

    it('refuses a line from another tenant', async () => {
      const fixture = await seedOrder();
      const foreignLineId = await seedForeignPartLine();

      const response = await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'KULANZ', lineItemIds: [foreignLineId] })
        .expect(422);
      expect(response.body.code).toBe('WARRANTY_CLAIM_LINE_NOT_ON_ORDER');
    });

    it('lets only one of two claims take a line when both are saved at the same time', async () => {
      const fixture = await seedOrder();
      const firstId = await createClaim(fixture.orderId);
      const secondId = await createClaim(fixture.orderId, { type: 'GARANTIE' });

      // Both saves need the line's row lock, so they wait on it until the test releases it.
      const releaseLine = await holdRowLock((tx) =>
        tx.$queryRaw`SELECT id FROM workshop_task_line_items WHERE id = ${fixture.partLineId} FOR UPDATE`,
      );
      let answered = false;
      const outcomesReady = Promise.all([
        request(app.getHttpServer())
          .patch(claimsPath(fixture.orderId, firstId))
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ lineItemIds: [fixture.partLineId] }),
        request(app.getHttpServer())
          .patch(claimsPath(fixture.orderId, secondId))
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ lineItemIds: [fixture.partLineId] }),
      ]).then((outcomes) => {
        answered = true;
        return outcomes;
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(answered).toBe(false);

      await releaseLine();
      const outcomes = await outcomesReady;

      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([200, 409]);
      const refused = outcomes.find((outcome) => outcome.status === 409);
      expect(refused?.body.code).toBe('WARRANTY_CLAIM_LINE_ALREADY_CLAIMED');
    });

    it('keeps both fields when two saves of one claim run at the same time', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId);

      // Both saves need the claim's row lock, so they wait on it until the test releases it.
      const releaseClaim = await holdRowLock((tx) =>
        tx.$queryRaw`SELECT id FROM warranty_claims WHERE id = ${claimId} FOR UPDATE`,
      );
      let answered = false;
      const savesDone = Promise.all([
        patchClaim(fixture.orderId, claimId, { complaint: 'Nachricht A' }),
        patchClaim(fixture.orderId, claimId, { causeCorrection: 'Ursache B' }),
      ]).then(() => {
        answered = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(answered).toBe(false);

      await releaseClaim();
      await savesDone;

      const stored = await request(app.getHttpServer())
        .get(claimsPath(fixture.orderId, claimId))
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(stored.body).toMatchObject({
        complaint: 'Nachricht A',
        causeCorrection: 'Ursache B',
      });
    });

    it('refuses to delete a task whose line is on a claim', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, { lineItemIds: [fixture.partLineId] });
      const line = await prisma.workshopTaskLineItem.findFirstOrThrow({
        where: { id: fixture.partLineId },
        select: { workshop_task_id: true },
      });

      const response = await request(app.getHttpServer())
        .delete(`/api/workshop/orders/${fixture.orderId}/tasks/${line.workshop_task_id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(422);
      expect(response.body.message).toBe(
        'This operation cannot be completed because of a related record.',
      );

      const claim = await request(app.getHttpServer())
        .get(claimsPath(fixture.orderId, claimId))
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(claim.body.lines).toEqual([
        expect.objectContaining({ workshopTaskLineItemId: fixture.partLineId }),
      ]);
    });
  });

  describe('roles for changes', () => {
    it('lets an owner file and edit a claim', async () => {
      const fixture = await seedOrder();
      const ownerToken = await createMemberToken('OWNER');

      const created = await request(app.getHttpServer())
        .post(claimsPath(fixture.orderId))
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ type: 'GARANTIE' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(claimsPath(fixture.orderId, created.body.id as string))
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ complaint: 'Eingetragen vom Inhaber' })
        .expect(200);
    });

    it('refuses a mechanic (TECH) to change a claim', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId);
      const mechanicToken = await createMemberToken('TECH');

      await request(app.getHttpServer())
        .patch(claimsPath(fixture.orderId, claimId))
        .set('Authorization', `Bearer ${mechanicToken}`)
        .send({ complaint: 'nicht erlaubt' })
        .expect(403);
    });
  });

  describe('printable summary', () => {
    it('renders a branded PDF summary of the claim', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, completeClaimBody(fixture));

      const download = await request(app.getHttpServer())
        .get(`${claimsPath(fixture.orderId, claimId)}/pdf`)
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(download.headers['content-type']).toContain('application/pdf');
      expect(download.headers['content-disposition']).toMatch(/^attachment; filename="kulanz-wo-aut464-.*\.pdf"$/);
      expect((download.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('prints the order, the claim type, the affected lines and the EUR amounts', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, completeClaimBody(fixture));
      const order = await prisma.workshopOrder.findFirstOrThrow({
        where: { id: fixture.orderId },
        select: { order_number: true },
      });

      const download = await request(app.getHttpServer())
        .get(`${claimsPath(fixture.orderId, claimId)}/pdf`)
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      const text = await readPdfText(download.body as Buffer);
      expect(text).toContain('Kulanzantrag');
      expect(text).toContain(order.order_number);
      expect(text).toContain('LAB-KUPPLUNG');
      expect(text).toContain('A1234567');
      expect(text).toContain('250,00');
      expect(text).toContain('1.250,00');
    });

    it('does not hand the PDF to mechanics', async () => {
      const fixture = await seedOrder();
      const claimId = await createClaim(fixture.orderId, completeClaimBody(fixture));
      const mechanicToken = await createMemberToken('TECH');

      await request(app.getHttpServer())
        .get(`${claimsPath(fixture.orderId, claimId)}/pdf`)
        .set('Authorization', `Bearer ${mechanicToken}`)
        .expect(403);
    });
  });
});
