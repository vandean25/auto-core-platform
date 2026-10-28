import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopEstimateStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SiteService } from '../src/site/site.service.js';
import {
  cleanupTestUsers,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

jest.setTimeout(120000);

const DAY = 24 * 60 * 60 * 1000;

/** AUT-795: GET /api/workshop/estimates, the estimates of the active site as a cursor-paged list. */
describe('Workshop estimates list (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let tenantEmail: string;
  let adminToken: string;
  let customerId: string;
  let mainSiteId: string;
  const createdUserIds: string[] = [];
  const versionIds: Record<string, string> = {};

  const api = () => request(app.getHttpServer());
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const now = Date.now();

  async function createEstimateVersion(label: string, auth = adminAuth()) {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        vin: `VIN-KVL-${randomUUID()}`,
        plate: `KV-${label}`,
        customer_id: customerId,
      },
    });
    const order = await api()
      .post('/api/workshop/orders')
      .set(auth)
      .send({
        customerId,
        vehicleId: vehicle.id,
        odometer: 120000,
        fuelLevel: 40,
        notes: label,
      })
      .expect(201);
    const created = await api()
      .post(`/api/workshop/orders/${order.body.id as string}/estimates`)
      .set(auth)
      .expect(201);
    return {
      orderId: order.body.id as string,
      orderNumber: order.body.order_number as string,
      versionId: created.body.versions[0].id as string,
    };
  }

  /** Puts a created version into the state under test without going through the send machinery. */
  async function setVersion(
    versionId: string,
    data: {
      status: WorkshopEstimateStatus;
      sentDaysAgo: number | null;
      validDays?: number;
    },
  ) {
    await prisma.workshopEstimateVersion.update({
      where: { id: versionId },
      data: {
        status: data.status,
        sent_at:
          data.sentDaysAgo === null
            ? null
            : new Date(now - data.sentDaysAgo * DAY),
        valid_until:
          data.validDays === undefined
            ? null
            : new Date(now + data.validDays * DAY),
        total_gross: '192.00',
      },
    });
  }

  function list(
    query: Record<string, string | number> = {},
    auth = adminAuth(),
  ) {
    return api().get('/api/workshop/estimates').set(auth).query(query);
  }

  /** Drafts have no sent date; they come last, by id descending. */
  const drafts = () => [versionIds.F, versionIds.G].sort().reverse();

  const ids = (body: { data: { version_id: string }[] }) =>
    body.data.map((row) => row.version_id);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const testTenant = await createTestTenant(basePrisma);
    tenantId = testTenant.tenantId;
    tenantEmail = testTenant.email;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);
    await seedReadySellerAndAccountingProfile(prisma, tenantId);
    mainSiteId = (
      await prisma.site.findFirstOrThrow({
        where: { tenant_id: tenantId },
        select: { id: true },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          tenant_id: tenantId,
          first_name: 'Anna',
          last_name: 'Beispiel',
          email: `kvl-${Date.now()}@example.com`,
          type: 'PRIVATE',
          address_street: 'Hauptstraße 2',
          address_zip: '8010',
          address_city: 'Graz',
          address_country: 'AT',
        },
      })
    ).id;

    const states: [
      string,
      WorkshopEstimateStatus,
      number | null,
      number | undefined,
    ][] = [
      ['A', WorkshopEstimateStatus.SENT, 1, 30],
      ['B', WorkshopEstimateStatus.SENT, 2, 30],
      ['C', WorkshopEstimateStatus.APPROVED, 3, 30],
      ['D', WorkshopEstimateStatus.SENT, 4, -1],
      ['E', WorkshopEstimateStatus.SUPERSEDED, 5, 30],
      ['F', WorkshopEstimateStatus.DRAFT, null, undefined],
      ['G', WorkshopEstimateStatus.DRAFT, null, undefined],
    ];
    for (const [label, status, sentDaysAgo, validDays] of states) {
      const created = await createEstimateVersion(label);
      versionIds[label] = created.versionId;
      await setVersion(created.versionId, { status, sentDaysAgo, validDays });
    }
  });

  afterAll(async () => {
    await prisma.workshopEstimateBrandAssetReference.deleteMany();
    await prisma.notificationOutbox.deleteMany();
    await prisma.workshopEstimateApprovalToken.deleteMany();
    await prisma.workshopEstimateVersion.deleteMany();
    await prisma.workshopEstimate.deleteMany();
    await prisma.workshopEstimateSequence.deleteMany();
    await prisma.workshopTaskLineItem.deleteMany();
    await prisma.workshopTask.deleteMany();
    await prisma.workshopOrder.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.customer.deleteMany();
    await cleanupTestUsers(basePrisma, createdUserIds);
    await teardownTestApp(app, prisma);
  });

  it('lists the versions of the site newest sent first, drafts last, without superseded versions', async () => {
    const response = await list().expect(200);

    expect(ids(response.body)).toEqual([
      versionIds.A,
      versionIds.B,
      versionIds.C,
      versionIds.D,
      ...drafts(),
    ]);
    expect(response.body.meta).toEqual({ page_size: 25, next_cursor: null });
    expect(response.body.data[0]).toMatchObject({
      version_id: versionIds.A,
      estimate_number: expect.stringMatching(/^KV-\d{4}-\d{4}$/),
      version: 1,
      status: 'SENT',
      order_number: expect.stringMatching(/^WO-/),
      customer_id: customerId,
      customer_name: 'Anna Beispiel',
      vehicle_plate: 'KV-A',
      total_gross: '192.00',
    });
    expect(response.body.data[0].sent_at).toEqual(expect.any(String));
    expect(response.body.data[0].valid_until).toEqual(expect.any(String));
  });

  it('filters by status, with a sent version past its validity counting as EXPIRED', async () => {
    expect(ids((await list({ status: 'SENT' }).expect(200)).body)).toEqual([
      versionIds.A,
      versionIds.B,
    ]);
    expect(ids((await list({ status: 'APPROVED' }).expect(200)).body)).toEqual([
      versionIds.C,
    ]);
    const expired = await list({ status: 'EXPIRED' }).expect(200);
    expect(ids(expired.body)).toEqual([versionIds.D]);
    expect(expired.body.data[0].status).toBe('EXPIRED');
    expect(ids((await list({ status: 'DRAFT' }).expect(200)).body)).toEqual(
      drafts(),
    );
  });

  it('pages across drafts, which have no sent date, without repeating or skipping one', async () => {
    const [firstDraft, secondDraft] = drafts();
    const first = await list({ status: 'DRAFT', pageSize: 1 }).expect(200);
    expect(ids(first.body)).toEqual([firstDraft]);
    const cursor = first.body.meta.next_cursor as string;
    expect(cursor).toEqual(expect.any(String));

    const second = await list({
      status: 'DRAFT',
      pageSize: 1,
      cursor,
    }).expect(200);
    expect(ids(second.body)).toEqual([secondDraft]);
    expect(second.body.meta.next_cursor).toBeNull();
  });

  it('shows superseded versions only when SUPERSEDED is asked for', async () => {
    expect(ids((await list().expect(200)).body)).not.toContain(versionIds.E);
    expect(
      ids((await list({ status: 'SUPERSEDED' }).expect(200)).body),
    ).toEqual([versionIds.E]);
  });

  it('filters by customer, order and the site-local sent range', async () => {
    expect((await list({ customerId }).expect(200)).body.data).toHaveLength(6);
    expect(
      (await list({ customerId: randomUUID() }).expect(200)).body.data,
    ).toEqual([]);

    const orderId = (
      await prisma.workshopEstimateVersion.findFirstOrThrow({
        where: { id: versionIds.B, tenant_id: tenantId },
        select: { estimate: { select: { workshop_order_id: true } } },
      })
    ).estimate.workshop_order_id;
    expect(ids((await list({ orderId }).expect(200)).body)).toEqual([
      versionIds.B,
    ]);

    // The range is read in the site's time zone, so the days are taken there, not in UTC.
    const day = (daysAgo: number) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(
        new Date(now - daysAgo * DAY),
      );
    const range = await list({ sentFrom: day(3), sentTo: day(2) }).expect(200);
    expect(ids(range.body)).toEqual(
      expect.arrayContaining([versionIds.B, versionIds.C]),
    );
    expect(ids(range.body)).not.toContain(versionIds.A);
    expect(ids(range.body)).not.toContain(versionIds.D);
  });

  it('pages with an opaque cursor that stays stable while newer estimates are sent', async () => {
    const firstPage = await list({ pageSize: 2 }).expect(200);
    expect(ids(firstPage.body)).toEqual([versionIds.A, versionIds.B]);
    expect(firstPage.body.meta.page_size).toBe(2);
    const cursor = firstPage.body.meta.next_cursor as string;
    expect(cursor).toEqual(expect.any(String));

    // A newer estimate arrives between the pages; it must not shift or repeat anything on the next pages.
    const newer = await createEstimateVersion('N');
    await setVersion(newer.versionId, {
      status: WorkshopEstimateStatus.SENT,
      sentDaysAgo: 0,
      validDays: 30,
    });

    const secondPage = await list({ pageSize: 2, cursor }).expect(200);
    expect(ids(secondPage.body)).toEqual([versionIds.C, versionIds.D]);
    const thirdPage = await list({
      pageSize: 2,
      cursor: secondPage.body.meta.next_cursor,
    }).expect(200);
    expect(ids(thirdPage.body)).toEqual(drafts());
    expect(thirdPage.body.meta.next_cursor).toBeNull();

    const seen = [
      ...ids(firstPage.body),
      ...ids(secondPage.body),
      ...ids(thirdPage.body),
    ];
    expect(new Set(seen).size).toBe(seen.length);
    expect(ids((await list().expect(200)).body)[0]).toBe(newer.versionId);
  });

  it('allows up to 100 rows per page and refuses more, a missing range end and unknown values', async () => {
    await list({ pageSize: 100 }).expect(200);
    await list({ pageSize: 101 }).expect(400);
    await list({ pageSize: 0 }).expect(400);
    await list({ sentFrom: '2026-10-01' }).expect(400);
    await list({ status: 'WAITING' }).expect(400);
    await list({ customerId: 'not-a-uuid' }).expect(400);
  });

  it('refuses a TECH session like the other estimate routes', async () => {
    const techFirebaseUid = `kvl-tech-${randomUUID()}`;
    const techEmail = `${techFirebaseUid}@example.com`;
    const techUser = await basePrisma.user.create({
      data: { firebaseUid: techFirebaseUid, email: techEmail },
    });
    createdUserIds.push(techUser.id);
    await seedTestTenantMember(basePrisma, {
      tenantId,
      userId: techUser.id,
      role: 'TECH',
    });
    const techToken = app.get(AuthService).createTestToken({
      sub: techFirebaseUid,
      email: techEmail,
      tenantId,
      role: 'TECH',
    });

    await list({}, { Authorization: `Bearer ${techToken}` }).expect(403);
  });

  it('does not list the estimates of another tenant', async () => {
    const otherTenant = await createTestTenant(basePrisma);
    const other = {
      Authorization: `Bearer ${createTestAuthToken(app.get(AuthService), otherTenant)}`,
    };

    const response = await list({}, other).expect(200);
    expect(response.body.data).toEqual([]);
  });

  it('lists only the estimates of the active site, never those of another site of the tenant', async () => {
    const second = await runWithTenantContext(tenantId, async () => {
      const legalEntity = await prisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantId },
        select: { id: true },
      });
      const user = await prisma.user.findFirstOrThrow({
        where: { email: tenantEmail },
        select: { id: true },
      });
      const siteService = app.get(SiteService);
      const site = await siteService.createSite({
        legalEntityId: legalEntity.id,
        code: 'KVL-SECOND',
        name: 'Zweiter Standort',
      });
      await siteService.addSiteMembership(site.id, { userId: user.id });
      return site;
    });
    await api()
      .patch('/api/me/active-site')
      .set(adminAuth())
      .send({ siteId: second.id })
      .expect(200);

    try {
      // Nothing of the first site shows up, and an estimate made on the second site appears only here.
      expect((await list().expect(200)).body.data).toEqual([]);
      const onSecond = await createEstimateVersion('S2');
      await setVersion(onSecond.versionId, {
        status: WorkshopEstimateStatus.SENT,
        sentDaysAgo: 1,
        validDays: 30,
      });
      expect(ids((await list().expect(200)).body)).toEqual([
        onSecond.versionId,
      ]);
    } finally {
      await api()
        .patch('/api/me/active-site')
        .set(adminAuth())
        .send({ siteId: mainSiteId })
        .expect(200);
    }

    const back = ids((await list({ pageSize: 100 }).expect(200)).body);
    expect(back).toContain(versionIds.A);
    expect(back.length).toBeGreaterThanOrEqual(6);
  });
});
