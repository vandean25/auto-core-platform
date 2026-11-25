import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SystemPrismaService } from '../src/prisma/system-prisma.service.js';
import {
  SEARCH_PROVIDERS,
  type SearchProvider,
  type SearchResultType,
} from '../src/search/search.types.js';
import { grantDemoSignIn } from './helpers/demo-sign-in-grant.js';
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
  let systemPrisma: SystemPrismaService;
  let authService: AuthService;
  let cleanupDemoGrant: (() => Promise<void>) | undefined;
  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;
  let prismaA: PrismaService;
  let mainSiteId: string;
  let branchSiteId: string;
  let foreignSiteId: string;
  let adminToken: string;
  let ownerToken: string;
  let techToken: string;
  let salesToken: string;
  let demoToken: string;
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

  async function createMember(
    role: 'OWNER' | 'TECH' | 'SALES' | 'DEMO',
    label: string,
    name?: { firstName: string; lastName: string },
  ) {
    return runWithTenantContext(tenantA.tenantId, async () => {
      const firebaseUid = `e2e-search-${label}-${SUFFIX}`;
      const user = await basePrisma.user.create({
        data: {
          firebaseUid,
          email: `${firebaseUid}@example.test`,
          ...(name ?? {}),
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId: tenantA.tenantId,
        userId: user.id,
        role,
      });
      const member = await basePrisma.tenantMember.findFirstOrThrow({
        where: { tenant_id: tenantA.tenantId, user_id: user.id },
        select: { id: true },
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
      const token = createTestAuthToken(authService, tenantA, {
        sub: firebaseUid,
        email: user.email,
        role,
      });
      return { token, memberId: member.id };
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
    systemPrisma = app.get<SystemPrismaService>(SystemPrismaService);
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
    ownerToken = (await createMember('OWNER', 'owner')).token;
    techToken = (await createMember('TECH', 'tech')).token;
    const salesMember = await createMember('SALES', 'sales', {
      firstName: 'Searchable',
      lastName: `User${SUFFIX}`,
    });
    salesToken = salesMember.token;
    ids.user = salesMember.memberId;
    const demoMember = await createMember('DEMO', 'demo', {
      firstName: 'Demo',
      lastName: `Müller${SUFFIX}`,
    });
    cleanupDemoGrant = await grantDemoSignIn(
      systemPrisma,
      basePrisma,
      `e2e-search-demo-${SUFFIX}`,
    );
    demoToken = demoMember.token;
    umlautIds.user = demoMember.memberId;

    const legalEntity = await prismaA.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
      select: { id: true },
    });

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

    const importJob = await prismaA.importJob.create({
      data: {
        tenant_id: tenantA.tenantId,
        entity_type: 'CUSTOMER',
        source_system: 'incadea',
        file_name: 'search-e2e.csv',
        file_sha256: `sha-${SUFFIX}`,
        status: 'APPLIED',
        mapping_json: {},
        options_json: {},
        totals_json: {},
      },
    });
    await prismaA.externalIdMapping.create({
      data: {
        tenant_id: tenantA.tenantId,
        entity_type: 'CUSTOMER',
        source_system: 'incadea',
        external_id: `INC-C-${SUFFIX}`,
        entity_id: customer.id,
        first_seen_import_job_id: importJob.id,
      },
    });
    await prismaA.externalIdMapping.create({
      data: {
        tenant_id: tenantA.tenantId,
        entity_type: 'VEHICLE',
        source_system: 'incadea',
        external_id: `INC-V-${SUFFIX}`,
        entity_id: vehicle.id,
        first_seen_import_job_id: importJob.id,
      },
    });

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

    const appointment = await prismaA.workshopOrder.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        order_number: `WO-APP-${SUFFIX}`,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        odometer: 1000,
        fuel_level: 50,
        status: 'SCHEDULED',
        scheduled_start_at: new Date('2026-10-25T10:00:00.000Z'),
      },
    });
    ids.appointment = appointment.id;

    const estimate = await prismaA.workshopEstimate.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        workshop_order_id: ids.orderMain,
        estimate_number: `KV-SRCH-${SUFFIX}`,
        year: 2026,
      },
    });
    ids.estimate = estimate.id;

    const salesOrder = await prismaA.salesOrder.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        order_number: `SO-SRCH-${SUFFIX}`,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        total_amount: 100,
      },
    });
    ids.sales_order = salesOrder.id;

    const vehicleSale = await prismaA.vehicleSale.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        sale_number: `VS-SRCH-${SUFFIX}`,
        vehicle_id: stock.id,
        customer_id: customer.id,
        sale_price: 15000,
      },
    });
    ids.vehicle_sale = vehicleSale.id;

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

    const creditNote = await prismaA.creditNote.create({
      data: {
        tenant_id: tenantA.tenantId,
        original_invoice_id: invoice.id,
        site_id: mainSiteId,
        legal_entity_id: legalEntity.id,
        status: 'FINALIZED',
        credit_number: `GS-SRCH-${SUFFIX}`,
        date: new Date(),
        reason: 'Search test credit',
      },
    });
    ids.credit_note = creditNote.id;

    const part = await prismaA.catalogItem.create({
      data: {
        tenant_id: tenantA.tenantId,
        sku: `SRCH-PAD-${SUFFIX}`,
        name: `Searchable${SUFFIX} Brake Pad`,
        retail_price: 10,
      },
    });
    ids.part = part.id;

    const laborOp = await prismaA.laborOperation.create({
      data: {
        tenant_id: tenantA.tenantId,
        code: `AW-SRCH-${SUFFIX}`,
        description: `Searchable Inspection ${SUFFIX}`,
        standard_aw: 1,
        hourly_rate: 120,
      },
    });
    ids.labor_operation = laborOp.id;

    const vendor = await prismaA.vendor.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `Searchable Vendor ${SUFFIX}`,
        email: `vendor.${SUFFIX}@searchable.example.test`,
        account_number: `VND-${SUFFIX}`,
      },
    });
    ids.vendor = vendor.id;

    const purchaseOrder = await prismaA.purchaseOrder.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        vendor_id: vendor.id,
        order_number: `PO-SRCH-${SUFFIX}`,
      },
    });
    ids.purchase_order = purchaseOrder.id;

    const purchaseInvoice = await prismaA.purchaseInvoice.create({
      data: {
        tenant_id: tenantA.tenantId,
        vendor_id: vendor.id,
        invoice_number: `ER-SRCH-${SUFFIX}`,
        vendor_invoice_number: `VINV-${SUFFIX}`,
        invoice_date: new Date(),
        due_date: new Date(),
        total_amount: 250,
      },
    });
    ids.purchase_invoice = purchaseInvoice.id;

    const employee = await prismaA.employee.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `Searchable Mechanic ${SUFFIX}`,
        role: 'MECHANIC',
      },
    });
    ids.employee = employee.id;

    const extraLegalEntity = await prismaA.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `Searchable Autohaus ${SUFFIX}`,
        country_iso: 'AT',
        tax_number: `ATU${SUFFIX}`,
        registration_number: `FN${SUFFIX}`,
      },
    });
    ids.legal_entity = extraLegalEntity.id;

    const extraSite = await prismaA.site.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: extraLegalEntity.id,
        code: `S${SUFFIX}`,
        name: `Searchable Standort ${SUFFIX}`,
        is_active: true,
      },
    });
    ids.site = extraSite.id;

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

    const umlautAppointment = await prismaA.workshopOrder.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        order_number: `WO-UAPP-${SUFFIX}`,
        customer_id: umlautCustomer.id,
        vehicle_id: umlautVehicle.id,
        odometer: 1000,
        fuel_level: 50,
        status: 'SCHEDULED',
        scheduled_start_at: new Date('2026-10-25T11:00:00.000Z'),
      },
    });
    umlautIds.appointment = umlautAppointment.id;

    const umlautEstimate = await prismaA.workshopEstimate.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        workshop_order_id: umlautIds.workshop_order,
        estimate_number: `KV-UML-${SUFFIX}`,
        year: 2026,
      },
    });
    umlautIds.estimate = umlautEstimate.id;

    const umlautSalesOrder = await prismaA.salesOrder.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        order_number: `SO-UML-${SUFFIX}`,
        customer_id: umlautCustomer.id,
        total_amount: 50,
      },
    });
    umlautIds.sales_order = umlautSalesOrder.id;

    const umlautVehicleSale = await prismaA.vehicleSale.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        sale_number: `VS-UML-${SUFFIX}`,
        vehicle_id: umlautStock.id,
        customer_id: umlautCustomer.id,
        sale_price: 12000,
      },
    });
    umlautIds.vehicle_sale = umlautVehicleSale.id;

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

    const umlautCreditNote = await prismaA.creditNote.create({
      data: {
        tenant_id: tenantA.tenantId,
        original_invoice_id: umlautInvoice.id,
        site_id: mainSiteId,
        legal_entity_id: legalEntity.id,
        status: 'FINALIZED',
        credit_number: `GS-UML-${SUFFIX}`,
        date: new Date(),
        reason: 'Umlaut credit',
      },
    });
    umlautIds.credit_note = umlautCreditNote.id;

    const umlautPart = await prismaA.catalogItem.create({
      data: {
        tenant_id: tenantA.tenantId,
        sku: `UML-PART-${SUFFIX}`,
        name: `Müller${SUFFIX} Filter`,
        retail_price: 15,
      },
    });
    umlautIds.part = umlautPart.id;

    const umlautLabor = await prismaA.laborOperation.create({
      data: {
        tenant_id: tenantA.tenantId,
        code: `AW-UML-${SUFFIX}`,
        description: `Müller${SUFFIX} Ölwechsel`,
        standard_aw: 1,
        hourly_rate: 100,
      },
    });
    umlautIds.labor_operation = umlautLabor.id;

    const umlautVendor = await prismaA.vendor.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `Müller${SUFFIX} Teile GmbH`,
        email: `mueller.${SUFFIX}@example.test`,
        account_number: `UMV-${SUFFIX}`,
      },
    });
    umlautIds.vendor = umlautVendor.id;

    const umlautPo = await prismaA.purchaseOrder.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: mainSiteId,
        vendor_id: umlautVendor.id,
        order_number: `PO-UML-${SUFFIX}`,
      },
    });
    umlautIds.purchase_order = umlautPo.id;

    const umlautPi = await prismaA.purchaseInvoice.create({
      data: {
        tenant_id: tenantA.tenantId,
        vendor_id: umlautVendor.id,
        invoice_number: `ER-UML-${SUFFIX}`,
        vendor_invoice_number: `UVI-${SUFFIX}`,
        invoice_date: new Date(),
        due_date: new Date(),
        total_amount: 100,
      },
    });
    umlautIds.purchase_invoice = umlautPi.id;

    const umlautEmp = await prismaA.employee.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `Anna Müller${SUFFIX}`,
        role: 'MECHANIC',
      },
    });
    umlautIds.employee = umlautEmp.id;

    const umlautLe = await prismaA.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: `Müller${SUFFIX} GmbH`,
        country_iso: 'AT',
      },
    });
    umlautIds.legal_entity = umlautLe.id;

    const umlautSite = await prismaA.site.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: umlautLe.id,
        code: `U${SUFFIX}`,
        name: `Standort Müller${SUFFIX}`,
        is_active: true,
      },
    });
    umlautIds.site = umlautSite.id;
  });

  afterAll(async () => {
    if (!app) return;
    try {
      await cleanupDemoGrant?.();
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
      ['appointment', `WO-APP-${SUFFIX}`, 'appointment', `/workshop/orders/`],
      ['estimate', `KV-SRCH-${SUFFIX}`, 'estimate', `/workshop/orders/`],
      ['sales_order', `SO-SRCH-${SUFFIX}`, 'sales_order', `/sales-orders/`],
      [
        'vehicle_sale',
        `VS-SRCH-${SUFFIX}`,
        'vehicle_sale',
        `/vehicle-stock/sales/`,
      ],
      ['invoice', `RE-SRCH-${SUFFIX}`, 'invoice', `/sales/invoices/`],
      ['credit_note', `GS-SRCH-${SUFFIX}`, 'credit_note', `/finance/credit-notes/`],
      ['part', `SRCH-PAD-${SUFFIX}`, 'part', `/inventory/`],
      [
        'labor_operation',
        `AW-SRCH-${SUFFIX}`,
        'labor_operation',
        `/settings/labor`,
      ],
      ['vendor', `VND-${SUFFIX}`, 'vendor', `/vendors/`],
      [
        'purchase_order',
        `PO-SRCH-${SUFFIX}`,
        'purchase_order',
        `/purchase-orders/`,
      ],
      [
        'purchase_invoice',
        `ER-SRCH-${SUFFIX}`,
        'purchase_invoice',
        `/purchase-bills/`,
      ],
      ['employee', `Searchable Mechanic ${SUFFIX}`, 'employee', `/hr/employees`],
      ['user', `User${SUFFIX}`, 'user', `/settings/team`],
      [
        'legal_entity',
        `ATU${SUFFIX}`,
        'legal_entity',
        `/settings/legal-entities`,
      ],
      ['site', `Searchable Standort ${SUFFIX}`, 'site', `/settings/sites`],
    ])('%s is found by %s', async (type, q, idKey, hrefPrefix) => {
      const groups = await groupsFor(adminToken, q);
      const group = groups.find((g) => g.type === type)!;
      expect(group.error).toBeUndefined();
      const hit = group.results.find((r) => r.id === ids[idKey]);
      expect(hit).toMatchObject({ type });
      expect(hit!.href.startsWith(hrefPrefix)).toBe(true);
      expect(hit!.score).toBeGreaterThan(0);
    });

    it('returns all 19 groups in registry order for ADMIN', async () => {
      const groups = await groupsFor(adminToken, `Searchable${SUFFIX}`);
      expect(groups.map((g) => g.type)).toEqual(providers.map((p) => p.type));
    });

    it('finds a customer by multi-word name in any order, by email, and by formatted phone', async () => {
      for (const q of [
        `searchable${SUFFIX} hubertus`,
        `hubertus.${SUFFIX}@searchable.example.test`,
        `+43 660 ${SUFFIX}`,
      ]) {
        const groups = await groupsFor(adminToken, q, { types: 'customer' });
        expect(groups[0].results.map((r) => r.id)).toContain(ids.customer);
      }
    });

    it('finds customers and vehicles by incadea external_id (exact and prefix)', async () => {
      for (const q of [`INC-C-${SUFFIX}`, `INC-C-`]) {
        const groups = await groupsFor(adminToken, q, { types: 'customer' });
        expect(groups[0].results.map((r) => r.id)).toContain(ids.customer);
      }
      for (const q of [`INC-V-${SUFFIX}`, `INC-V-`]) {
        const groups = await groupsFor(adminToken, q, { types: 'vehicle' });
        expect(groups[0].results.map((r) => r.id)).toContain(ids.vehicle);
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
        appointment: `WO-APP-${SUFFIX}`,
        estimate: `KV-SRCH-${SUFFIX}`,
        sales_order: `SO-SRCH-${SUFFIX}`,
        vehicle_sale: `VS-SRCH-${SUFFIX}`,
        invoice: `RE-SRCH-${SUFFIX}`,
        credit_note: `GS-SRCH-${SUFFIX}`,
        part: `SRCH-PAD-${SUFFIX}`,
        labor_operation: `AW-SRCH-${SUFFIX}`,
        vendor: `VND-${SUFFIX}`,
        purchase_order: `PO-SRCH-${SUFFIX}`,
        purchase_invoice: `ER-SRCH-${SUFFIX}`,
        employee: `Searchable Mechanic ${SUFFIX}`,
        user: `User${SUFFIX}`,
        legal_entity: `ATU${SUFFIX}`,
        site: `Searchable Standort ${SUFFIX}`,
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
        { role: 'OWNER', token: ownerToken },
        { role: 'ADMIN', token: adminToken },
        { role: 'SALES', token: salesToken },
        { role: 'TECH', token: techToken },
        { role: 'DEMO', token: demoToken },
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

  describe('partial failure', () => {
    it('returns 200 with error: unavailable on the failing group without affecting other groups', async () => {
      const spy = jest
        .spyOn(providers[0], 'search')
        .mockRejectedValueOnce(new Error('provider boom'));
      try {
        const groups = await groupsFor(adminToken, `Searchable${SUFFIX}`);
        const failing = groups.find((g) => g.type === providers[0].type);
        expect(failing).toEqual({
          type: providers[0].type,
          results: [],
          error: 'unavailable',
        });
        const partGroup = groups.find((g) => g.type === 'part');
        expect(partGroup?.error).toBeUndefined();
        expect(partGroup?.results.map((r) => r.id)).toContain(ids.part);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
