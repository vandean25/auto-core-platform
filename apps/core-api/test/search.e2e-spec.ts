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
  runWithTenantContext,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

type Group = {
  type: string;
  results: Array<Record<string, any>>;
  error?: string;
};

const SUFFIX = `${Date.now()}`.slice(-6);
const VIN = 'SRCHVN00000000001';
const PLATE = 'W7777SX';

/**
 * AUT-662 GET /api/search: one hit per type, tenant isolation, role split and
 * the site rule. All fixtures are synthetic.
 */
describe('Global search (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let authService: AuthService;
  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;
  let prismaA: PrismaService;
  let mainSiteId: string;
  let branchSiteId: string;
  let foreignSiteId: string;
  let adminToken: string;
  let techToken: string;
  let salesToken: string;
  let tenantBToken: string;
  const ids: Record<string, string> = {};

  async function search(token: string, query: Record<string, string | number>) {
    return request(app.getHttpServer())
      .get('/api/search')
      .set('Authorization', `Bearer ${token}`)
      .query(query);
  }

  async function groupsFor(
    token: string,
    q: string,
    extra: Record<string, string | number> = {},
  ): Promise<Group[]> {
    const res = await search(token, { q, ...extra });
    expect(res.status).toBe(200);
    return res.body.groups as Group[];
  }

  async function createMember(role: 'TECH' | 'SALES', label: string) {
    return runWithTenantContext(tenantA.tenantId, async () => {
      const firebaseUid = `e2e-search-${label}-${SUFFIX}`;
      const user = await basePrisma.user.create({
        data: { firebaseUid, email: `${firebaseUid}@example.test` },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId: tenantA.tenantId,
        userId: user.id,
        role,
      });
      await basePrisma.siteMembership.create({
        data: {
          tenant_id: tenantA.tenantId,
          user_id: user.id,
          site_id: mainSiteId,
          is_active: true,
        },
      });
      await basePrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: mainSiteId },
      });
      return createTestAuthToken(authService, tenantA, {
        sub: firebaseUid,
        email: user.email,
        role,
      });
    });
  }

  async function createSite(code: string, withAdminMembership: boolean) {
    const legalEntity = await prismaA.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
      select: { id: true },
    });
    const site = await prismaA.site.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: legalEntity.id,
        code,
        name: `Search ${code} ${SUFFIX}`,
        is_active: true,
      },
    });
    if (withAdminMembership) {
      const admin = await basePrisma.user.findFirstOrThrow({
        where: { firebaseUid: tenantA.firebaseUid },
        select: { id: true },
      });
      await prismaA.siteMembership.create({
        data: {
          tenant_id: tenantA.tenantId,
          user_id: admin.id,
          site_id: site.id,
          is_active: true,
        },
      });
    }
    return site.id;
  }

  async function createOrder(
    siteId: string,
    orderNumber: string,
    customerId: string,
    vehicleId: string,
  ) {
    const order = await prismaA.workshopOrder.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: siteId,
        order_number: orderNumber,
        customer_id: customerId,
        vehicle_id: vehicleId,
        odometer: 1000,
        fuel_level: 50,
        status: 'INTAKE',
      },
    });
    return order.id;
  }

  beforeAll(async () => {
    app = await createE2eApp();
    basePrisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);

    tenantA = await createTestTenant(basePrisma, 'search-a');
    tenantB = await createTestTenant(basePrisma, 'search-b');
    prismaA = createTenantAwarePrisma(basePrisma, tenantA.tenantId);
    mainSiteId = await resolveTestMainSiteId(basePrisma, tenantA.tenantId);
    branchSiteId = await createSite('BRANCH', true);
    foreignSiteId = await createSite('FOREIGN', false);

    adminToken = createTestAuthToken(authService, tenantA);
    tenantBToken = createTestAuthToken(authService, tenantB);
    techToken = await createMember('TECH', 'tech');
    salesToken = await createMember('SALES', 'sales');

    const customer = await prismaA.customer.create({
      data: {
        tenant_id: tenantA.tenantId,
        first_name: 'Hubertus',
        last_name: `Searchable${SUFFIX}`,
        email: `hubertus.${SUFFIX}@searchable.example.test`,
        phone: `+43 660 ${SUFFIX}`,
        type: 'PRIVATE',
      },
    });
    ids.customer = customer.id;

    const vehicle = await prismaA.vehicle.create({
      data: {
        tenant_id: tenantA.tenantId,
        make: 'Searchmake',
        model: 'Probe',
        year: 2020,
        vin: VIN,
        plate: PLATE,
        customer_id: customer.id,
      },
    });
    ids.vehicle = vehicle.id;

    const stock = await prismaA.vehicle.create({
      data: {
        tenant_id: tenantA.tenantId,
        make: 'Stockmake',
        model: `Lot${SUFFIX}`,
        year: 2022,
        plate: 'G123SK',
        inventory_role: 'USED',
        stock_status: 'IN_STOCK',
        site_id: mainSiteId,
      },
    });
    ids.stock = stock.id;

    ids.orderMain = await createOrder(
      mainSiteId,
      `WO-SRCH-${SUFFIX}-1`,
      customer.id,
      vehicle.id,
    );
    ids.orderBranch = await createOrder(
      branchSiteId,
      `WO-SRCH-${SUFFIX}-2`,
      customer.id,
      vehicle.id,
    );
    ids.orderForeign = await createOrder(
      foreignSiteId,
      `WO-SRCH-${SUFFIX}-3`,
      customer.id,
      vehicle.id,
    );

    const invoice = await prismaA.invoice.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        customer_id: customer.id,
        invoice_number: `RE-SRCH-${SUFFIX}`,
        status: 'ISSUED',
        due_date: new Date(),
        total_net: 10,
        total_tax: 2,
        total_gross: 12,
      },
    });
    ids.invoice = invoice.id;

    const part = await prismaA.catalogItem.create({
      data: {
        tenant_id: tenantA.tenantId,
        sku: `SRCH-PAD-${SUFFIX}`,
        name: `Searchable Brake Pad ${SUFFIX}`,
        retail_price: 10,
      },
    });
    ids.part = part.id;
  });

  afterAll(async () => {
    if (!app) return;
    try {
      await cleanupTestTenantGraph(basePrisma, tenantA.tenantId);
      await cleanupTestTenantGraph(basePrisma, tenantB.tenantId);
    } finally {
      await teardownTestApp(app, basePrisma);
    }
  });

  describe('one hit per type', () => {
    it.each([
      ['customer', `Searchable${SUFFIX}`, 'customer', `/customers/`],
      ['vehicle', PLATE, 'vehicle', `/vehicles/`],
      ['stock_vehicle', `Lot${SUFFIX}`, 'stock', `/vehicle-stock/`],
      [
        'workshop_order',
        `WO-SRCH-${SUFFIX}-1`,
        'orderMain',
        `/workshop/orders/`,
      ],
      ['invoice', `RE-SRCH-${SUFFIX}`, 'invoice', `/sales/invoices/`],
      ['part', `SRCH-PAD-${SUFFIX}`, 'part', `/inventory/`],
    ])('%s is found by %s', async (type, q, idKey, hrefPrefix) => {
      const groups = await groupsFor(adminToken, q);
      const group = groups.find((g) => g.type === type)!;
      expect(group.error).toBeUndefined();
      const hit = group.results.find((r) => r.id === ids[idKey]);
      expect(hit).toMatchObject({ type });
      expect(hit!.href.startsWith(hrefPrefix)).toBe(true);
      expect(hit!.score).toBeGreaterThan(0);
    });

    it('returns all six groups in registry order for ADMIN', async () => {
      const groups = await groupsFor(adminToken, `Searchable${SUFFIX}`);
      expect(groups.map((g) => g.type)).toEqual([
        'customer',
        'vehicle',
        'stock_vehicle',
        'workshop_order',
        'invoice',
        'part',
      ]);
    });

    it('finds a customer by multi-word name in any order and by email', async () => {
      for (const q of [
        `searchable${SUFFIX} hubertus`,
        `hubertus.${SUFFIX}@searchable.example.test`,
      ]) {
        const groups = await groupsFor(adminToken, q, { types: 'customer' });
        expect(groups[0].results.map((r) => r.id)).toContain(ids.customer);
      }
    });

    it('finds a vehicle by VIN and by plate typed with separators', async () => {
      for (const q of [VIN, 'w-7777-sx']) {
        const groups = await groupsFor(adminToken, q, { types: 'vehicle' });
        expect(groups[0].results.map((r) => r.id)).toContain(ids.vehicle);
      }
    });

    it('finds a customer and a workshop order by id', async () => {
      for (const [id, type] of [
        [ids.customer, 'customer'],
        [ids.orderMain, 'workshop_order'],
      ]) {
        const groups = await groupsFor(adminToken, id, { types: type });
        expect(groups[0].results.map((r) => r.id)).toContain(id);
      }
    });

    it('ranks an exact document number above a partial one', async () => {
      const groups = await groupsFor(adminToken, `WO-SRCH-${SUFFIX}-1`, {
        types: 'workshop_order',
      });
      expect(groups[0].results[0]).toMatchObject({
        id: ids.orderMain,
        score: 1,
      });
    });

    it('treats % and _ as literal characters, not wildcards', async () => {
      for (const q of ['%%', '__', 'Hub%']) {
        const groups = await groupsFor(adminToken, q, { types: 'customer' });
        expect(groups[0].results).toEqual([]);
      }
    });

    it('honours types and limit', async () => {
      const groups = await groupsFor(adminToken, `WO-SRCH-${SUFFIX}`, {
        types: 'workshop_order',
        limit: 1,
      });
      expect(groups).toHaveLength(1);
      expect(groups[0].results).toHaveLength(1);
    });
  });

  describe('tenant isolation', () => {
    it('tenant B sees nothing of tenant A', async () => {
      const queries = [
        `Searchable${SUFFIX}`,
        PLATE,
        VIN,
        `Lot${SUFFIX}`,
        `WO-SRCH-${SUFFIX}`,
        `RE-SRCH-${SUFFIX}`,
        `SRCH-PAD-${SUFFIX}`,
        ids.customer,
      ];
      for (const q of queries) {
        const groups = await groupsFor(tenantBToken, q);
        expect(groups.flatMap((g) => g.results)).toEqual([]);
      }
    });
  });

  describe('site rule', () => {
    it('lists active-site orders first, then other authorized sites with siteId, never an unauthorized site', async () => {
      const groups = await groupsFor(adminToken, `WO-SRCH-${SUFFIX}`, {
        types: 'workshop_order',
      });
      const results = groups[0].results;
      expect(results.map((r) => [r.id, r.siteId])).toEqual([
        [ids.orderMain, mainSiteId],
        [ids.orderBranch, branchSiteId],
      ]);
      expect(results.map((r) => r.id)).not.toContain(ids.orderForeign);
    });

    it('returns the invoice with its site', async () => {
      const groups = await groupsFor(adminToken, `RE-SRCH-${SUFFIX}`, {
        types: 'invoice',
      });
      expect(groups[0].results[0]).toMatchObject({
        id: ids.invoice,
        siteId: mainSiteId,
      });
    });
  });

  describe('role split', () => {
    it('SALES receives all six types', async () => {
      const groups = await groupsFor(salesToken, `Searchable${SUFFIX}`);
      expect(groups.map((g) => g.type)).toHaveLength(6);
    });

    it('TECH gets 200 with only customer, vehicle and workshop_order', async () => {
      const groups = await groupsFor(techToken, `Searchable${SUFFIX}`);
      expect(groups.map((g) => g.type)).toEqual([
        'customer',
        'vehicle',
        'workshop_order',
      ]);
    });

    it('TECH cannot request restricted types', async () => {
      const groups = await groupsFor(techToken, `RE-SRCH-${SUFFIX}`, {
        types: 'invoice,part',
      });
      expect(groups).toEqual([]);
    });

    it('TECH customer results carry no email or phone', async () => {
      const groups = await groupsFor(techToken, `Searchable${SUFFIX}`, {
        types: 'customer',
      });
      const hit = groups[0].results.find((r) => r.id === ids.customer)!;
      expect(hit.title).toBe(`Hubertus Searchable${SUFFIX}`);
      expect(hit.subtitle).toBeNull();
      expect(JSON.stringify(groups)).not.toContain('@searchable.example.test');
      expect(JSON.stringify(groups)).not.toContain('+43 660');
    });

    it('TECH cannot find a customer by email or phone', async () => {
      for (const q of [
        `hubertus.${SUFFIX}@searchable.example.test`,
        `+43 660 ${SUFFIX}`,
      ]) {
        const groups = await groupsFor(techToken, q, { types: 'customer' });
        expect(groups[0].results).toEqual([]);
      }
    });

    it('ADMIN sees the contact subtitle that TECH does not', async () => {
      const groups = await groupsFor(adminToken, `Searchable${SUFFIX}`, {
        types: 'customer',
      });
      const hit = groups[0].results.find((r) => r.id === ids.customer)!;
      expect(hit.subtitle).toContain('@searchable.example.test');
    });
  });

  describe('validation', () => {
    it('rejects a q shorter than 2 characters', async () => {
      expect((await search(adminToken, { q: 'a' })).status).toBe(400);
      expect((await search(adminToken, { q: ' a ' })).status).toBe(400);
      expect((await search(adminToken, {})).status).toBe(400);
    });

    it('allows a single digit', async () => {
      const res = await search(adminToken, { q: '7' });
      expect(res.status).toBe(200);
    });

    it('rejects an out-of-range limit and an unknown type', async () => {
      expect((await search(adminToken, { q: 'max', limit: 11 })).status).toBe(
        400,
      );
      expect((await search(adminToken, { q: 'max', limit: 0 })).status).toBe(
        400,
      );
      expect(
        (await search(adminToken, { q: 'max', types: 'bogus' })).status,
      ).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'max' });
      expect(res.status).toBe(401);
    });
  });
});
