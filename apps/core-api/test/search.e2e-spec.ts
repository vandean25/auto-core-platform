import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  SEARCH_PROVIDERS,
  type SearchProvider,
  type SearchResultType,
} from '../src/search/search.types.js';
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
const PLATE = 'W 7777 SX';
const PLATE_NORMALIZED = 'W7777SX';

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
  let providers: SearchProvider[];
  const ids: Record<string, string> = {};
  const umlautIds: Partial<Record<SearchResultType, string>> = {};

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
    providers = app.get<SearchProvider[]>(SEARCH_PROVIDERS);

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
        plate_normalized: PLATE_NORMALIZED,
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
        plate: 'G 123 SK',
        plate_normalized: 'G123SK',
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

    const umlautCustomer = await prismaA.customer.create({
      data: {
        tenant_id: tenantA.tenantId,
        first_name: 'Österreich',
        last_name: `Müller${SUFFIX}`,
        company_name: `Straße${SUFFIX} GmbH`,
        type: 'PRIVATE',
      },
    });
    umlautIds.customer = umlautCustomer.id;

    const umlautVehicle = await prismaA.vehicle.create({
      data: {
        tenant_id: tenantA.tenantId,
        make: `Müller${SUFFIX}`,
        model: 'Ärger',
        year: 2021,
        plate: `MUE${SUFFIX}`,
        plate_normalized: `MUE${SUFFIX}`,
        customer_id: umlautCustomer.id,
      },
    });
    umlautIds.vehicle = umlautVehicle.id;

    const umlautStock = await prismaA.vehicle.create({
      data: {
        tenant_id: tenantA.tenantId,
        make: 'Stock',
        model: `Müller${SUFFIX}`,
        year: 2022,
        plate: `STM${SUFFIX}`,
        plate_normalized: `STM${SUFFIX}`,
        inventory_role: 'USED',
        stock_status: 'IN_STOCK',
        site_id: mainSiteId,
      },
    });
    umlautIds.stock_vehicle = umlautStock.id;

    umlautIds.workshop_order = await createOrder(
      mainSiteId,
      `WO-UML-${SUFFIX}`,
      umlautCustomer.id,
      umlautVehicle.id,
    );

    const umlautInvoice = await prismaA.invoice.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        customer_id: umlautCustomer.id,
        invoice_number: `RE-UML-${SUFFIX}`,
        status: 'ISSUED',
        due_date: new Date(),
        total_net: 10,
        total_tax: 2,
        total_gross: 12,
      },
    });
    umlautIds.invoice = umlautInvoice.id;

    const umlautPart = await prismaA.catalogItem.create({
      data: {
        tenant_id: tenantA.tenantId,
        sku: `UML-PART-${SUFFIX}`,
        name: `Müller${SUFFIX} Filter`,
        retail_price: 15,
      },
    });
    umlautIds.part = umlautPart.id;
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
      ['vehicle', PLATE_NORMALIZED, 'vehicle', `/vehicles/`],
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

    it('finds a vehicle by VIN, VIN prefix and suffix, and by plate however it is typed', async () => {
      for (const q of [
        VIN,
        'SRCHVN0000',
        'VN00000000001',
        'w-7777-sx',
        'w.7777.sx',
        'W 7777',
      ]) {
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
    it('tenant B sees nothing of tenant A for any registered provider', async () => {
      const fixtureByType: Record<SearchResultType, string> = {
        customer: `Searchable${SUFFIX}`,
        vehicle: PLATE_NORMALIZED,
        stock_vehicle: `Lot${SUFFIX}`,
        workshop_order: `WO-SRCH-${SUFFIX}-1`,
        invoice: `RE-SRCH-${SUFFIX}`,
        part: `SRCH-PAD-${SUFFIX}`,
      };
      for (const p of providers) {
        const q = fixtureByType[p.type];
        expect(q).toBeDefined();
        const tenantAHits = await groupsFor(adminToken, q, { types: p.type });
        expect(tenantAHits[0].results.length).toBeGreaterThan(0);

        const tenantBHits = await groupsFor(tenantBToken, q, { types: p.type });
        expect(tenantBHits[0].results).toEqual([]);
      }
      const idGroups = await groupsFor(tenantBToken, ids.customer);
      expect(idGroups.flatMap((g) => g.results)).toEqual([]);
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
    it('returns exactly each role allowed types in registry order and drops/rejects disallowed types', async () => {
      const roleTokens: Array<{ role: string; token: string }> = [
        { role: 'ADMIN', token: adminToken },
        { role: 'SALES', token: salesToken },
        { role: 'TECH', token: techToken },
      ];
      for (const { role, token } of roleTokens) {
        const expectedTypes = providers
          .filter((p) => p.allowedRoles.includes(role))
          .map((p) => p.type);
        const groups = await groupsFor(token, `Searchable${SUFFIX}`);
        expect(groups.map((g) => g.type)).toEqual(expectedTypes);

        for (const p of providers.filter((item) => !item.allowedRoles.includes(role))) {
          const restricted = await groupsFor(token, `Searchable${SUFFIX}`, {
            types: p.type,
          });
          expect(restricted).toEqual([]);
        }
      }
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

    it('TECH cannot probe customer contact data through workshop orders', async () => {
      for (const q of [
        `hubertus.${SUFFIX}@searchable.example.test`,
        `+43 660 ${SUFFIX}`,
      ]) {
        const groups = await groupsFor(techToken, q, {
          types: 'workshop_order',
        });
        expect(groups[0].results).toEqual([]);
      }
    });

    it('ADMIN finds orders by customer email, which TECH cannot', async () => {
      const groups = await groupsFor(
        adminToken,
        `hubertus.${SUFFIX}@searchable.example.test`,
        { types: 'workshop_order' },
      );
      expect(groups[0].results.map((r) => r.id)).toContain(ids.orderMain);
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

    it('treats an empty types list as not set', async () => {
      const res = await search(adminToken, { q: 'max', types: '' });
      expect(res.status).toBe(200);
      expect(res.body.groups.length).toBeGreaterThan(0);
    });

    it('requires authentication', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ q: 'max' });
      expect(res.status).toBe(401);
    });
  });

  describe('umlauts and sharp s', () => {
    it('matches German umlauts case-insensitively (MÜLLER finds Müller) for every registered provider', async () => {
      for (const p of providers) {
        const expectedId = umlautIds[p.type];
        expect(expectedId).toBeDefined();
        const groups = await groupsFor(adminToken, `MÜLLER${SUFFIX}`, {
          types: p.type,
        });
        expect(groups[0].results.map((r) => r.id)).toContain(expectedId);
      }
    });

    it('matches ä/ö case-insensitively and documents that ß does not fold to ss', async () => {
      const oeGroups = await groupsFor(adminToken, 'ÖSTERREICH', {
        types: 'customer',
      });
      expect(oeGroups[0].results.map((r) => r.id)).toContain(
        umlautIds.customer,
      );

      const aeGroups = await groupsFor(adminToken, 'ÄRGER', {
        types: 'vehicle',
      });
      expect(aeGroups[0].results.map((r) => r.id)).toContain(umlautIds.vehicle);

      const exactSharpS = await groupsFor(adminToken, `Straße${SUFFIX}`, {
        types: 'customer',
      });
      expect(exactSharpS[0].results.map((r) => r.id)).toContain(
        umlautIds.customer,
      );

      const foldedSharpS = await groupsFor(adminToken, `strasse${SUFFIX}`, {
        types: 'customer',
      });
      expect(foldedSharpS[0].results).toEqual([]);
    });
  });
});
