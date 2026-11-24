import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TenantMemberRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { createGlobalValidationPipe } from './../src/common/index.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { SystemPrismaService } from './../src/prisma/system-prisma.service.js';
import { AuthService } from './../src/auth/auth.service.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('FinanceModule (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let authService: AuthService;
  let authHeader: string;
  let tenantId: string;
  const roleHeaders: Partial<Record<TenantMemberRole, string>> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    basePrisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);

    const testTenant = await createTestTenant(basePrisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    // sales_orders.order_number is globally unique in the database (init migration), so every tenant
    // starting at SO-2026-1001 collides with other suites that share this database. Start this tenant's
    // counter at a per-run value instead.
    const salesOrderStart = 100_000 + Math.floor(Math.random() * 800_000);
    await prisma.financeSettings.upsert({
      where: { tenant_id: tenantId },
      update: { next_sales_order_number: salesOrderStart },
      create: {
        tenant_id: tenantId,
        workshop_order_prefix: 'WO-2026-',
        next_sales_order_number: salesOrderStart,
      },
    });
    authHeader = `Bearer ${createTestAuthToken(authService, testTenant)}`;
    roleHeaders.ADMIN = authHeader;

    const systemPrisma = app.get(SystemPrismaService);
    await runWithTenantContext(tenantId, async () => {
      for (const role of ['OWNER', 'SALES', 'TECH', 'DEMO'] as const) {
        const firebaseUid = `fin-${role.toLowerCase()}-${tenantId}`;
        const email = `fin-${role.toLowerCase()}-${tenantId}@test.com`;
        const user = await systemPrisma.user.create({
          data: { firebaseUid, email },
        });
        await seedTestTenantMember(prisma, {
          tenantId,
          userId: user.id,
          role,
        });
        if (role === 'DEMO') {
          const accessRequest = await systemPrisma.landingDemoAccessRequest.create({
            data: {
              email,
              name: 'Finance Demo Viewer',
              betrieb: 'E2E',
              consent_recorded_at: new Date(),
            },
            select: { id: true },
          });
          await systemPrisma.landingDemoSignInGrant.create({
            data: {
              access_request_id: accessRequest.id,
              user_id: user.id,
              expires_at: new Date(Date.now() + 60 * 60 * 1000),
            },
          });
        }
        roleHeaders[role] = `Bearer ${createTestAuthToken(authService, {
          ...testTenant,
          firebaseUid,
          email,
          role,
        })}`;
      }
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.inventoryTransaction.deleteMany();
    await prisma.inventoryValuation.deleteMany();
    await prisma.inventoryStock.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.vehicleLedgerEntry.deleteMany();
    await prisma.vehicleSale.deleteMany();
    await prisma.vehicleParty.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.storageLocation.deleteMany();
    await prisma.salesOrderItem.deleteMany();
    await prisma.salesOrder.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.catalogItem.deleteMany();
    await prisma.revenueGroup.deleteMany();
    await prisma.brand.deleteMany();
    await teardownTestApp(app, prisma);
  });

  it('/finance/settings (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/finance/settings')
      .set('Authorization', authHeader)
      .expect(200);

    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('invoice_prefix');
  });

  it('/finance/settings (PATCH) - Update lock_date', async () => {
    const lockDate = new Date('2025-12-31').toISOString();
    const response = await request(app.getHttpServer())
      .patch('/finance/settings')
      .set('Authorization', authHeader)
      .send({ lock_date: lockDate })
      .expect(200);

    expect(new Date(response.body.lock_date).toISOString()).toBe(lockDate);
  });

  it('Fiscal Lock Enforcement - Prevent Finalization before lock_date', async () => {
    await request(app.getHttpServer())
      .get('/finance/settings')
      .set('Authorization', authHeader)
      .expect(200);

    await request(app.getHttpServer())
      .patch('/finance/settings')
      .set('Authorization', authHeader)
      .send({ lock_date: new Date('2025-12-31').toISOString() })
      .expect(200);

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Finance',
        last_name: 'Test',
        email: `fin-${Date.now()}@test.com`,
      },
    });

    const oldDate = new Date('2025-06-01');
    const invoice = await prisma.invoice.create({
      data: {
        tenant_id: tenantId,
        customer_id: customer.id,
        date: oldDate,
        due_date: new Date('2025-06-15'),
        status: 'DRAFT',
        total_net: 100,
        total_tax: 20,
        total_gross: 120,
      },
    });

    const response = await request(app.getHttpServer())
      .put(`/sales/invoices/${invoice.id}/finalize`)
      .set('Authorization', authHeader)
      .expect(400);

    expect(response.body.code).toBe('SOURCE_DOCUMENT_REQUIRED');
  });

  it('Revenue Group Snapshot - Create Invoice Draft from sales order', async () => {
    const revenueGroupName = `E2E Test Parts 20% ${Date.now()}`;

    // 1. Setup Test Data (Self-contained)
    const revGroup = await prisma.revenueGroup.upsert({
      where: {
        tenant_id_name: {
          tenant_id: tenantId,
          name: revenueGroupName,
        },
      },
      update: {},
      create: {
        tenant_id: tenantId,
        name: revenueGroupName,
        tax_rate: 20.0,
        account_number: 'E2E-4000',
      },
    });

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Snapshot',
        last_name: 'Test',
        email: `snap-${Date.now()}@test.com`,
      },
    });

    const catalogItem = await prisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: `SNAP-ITEM-${Date.now()}`,
        name: 'Snapshot Item',
        cost_price: 50,
        retail_price: 100,
        revenue_group_id: revGroup.id,
      },
    });

    const orderRes = await request(app.getHttpServer())
      .post('/sales-orders')
      .set('Authorization', authHeader)
      .send({
        customer_id: customer.id,
        items: [
          {
            catalog_item_id: catalogItem.id,
            description: 'Snapshot Item',
            quantity: 1,
            unit_price: 100,
            tax_rate: 0,
          },
        ],
      })
      .expect(201);

    await prisma.salesOrder.updateMany({
      where: { id: orderRes.body.id },
      data: { status: 'CONFIRMED' },
    });

    const response = await request(app.getHttpServer())
      .post(`/sales-orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', authHeader)
      .expect(201);

    const invoice = await prisma.invoice.findFirst({
      where: { id: response.body.id },
      include: { items: true },
    });

    expect(invoice?.items[0]?.revenue_group_name).toBe('Sales');
    expect(Number(invoice?.items[0]?.tax_rate)).toBe(20);
  });

  it('rejects source-less sales invoice draft creation', async () => {
    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Blocked',
        last_name: 'Draft',
        email: `blocked-${Date.now()}@test.com`,
      },
    });

    await request(app.getHttpServer())
      .post('/sales/invoices')
      .set('Authorization', authHeader)
      .send({
        customerId: customer.id,
        items: [
          {
            description: 'Manual line',
            quantity: 1,
            unitPrice: 100,
            taxRate: 20,
          },
        ],
      })
      .expect(400);
  });

  // AUT-1007 Scenario 1: OWNER and ADMIN can update finance settings
  it.each(['OWNER', 'ADMIN'] as const)(
    'allows %s to PATCH /finance/settings (200 and values saved)',
    async (role) => {
      const nextMonth = role === 'OWNER' ? 3 : 4;
      const response = await request(app.getHttpServer())
        .patch('/finance/settings')
        .set('Authorization', roleHeaders[role] ?? '')
        .send({ fiscal_year_start_month: nextMonth })
        .expect(200);

      expect(response.body.fiscal_year_start_month).toBe(nextMonth);

      const saved = await prisma.financeSettings.findFirst({
        where: { tenant_id: tenantId },
      });
      expect(saved?.fiscal_year_start_month).toBe(nextMonth);
    },
  );

  // AUT-1007 Scenario 2 & Anti-criterion 1: SALES, TECH, and DEMO get 403 and DB row is byte-identical
  it.each(['SALES', 'TECH', 'DEMO'] as const)(
    'rejects %s on PATCH /finance/settings with 403 and leaves DB row unchanged',
    async (role) => {
      const fixtureLockDate = new Date('2025-11-30T00:00:00.000Z');
      await request(app.getHttpServer())
        .patch('/finance/settings')
        .set('Authorization', roleHeaders.OWNER!)
        .send({
          fiscal_year_start_month: 1,
          lock_date: fixtureLockDate.toISOString(),
        })
        .expect(200);

      const before = await prisma.financeSettings.findFirst({
        where: { tenant_id: tenantId },
      });

      await request(app.getHttpServer())
        .patch('/finance/settings')
        .set('Authorization', roleHeaders[role] ?? '')
        .send({
          fiscal_year_start_month: 7,
          lock_date: null,
        })
        .expect(403);

      const after = await prisma.financeSettings.findFirst({
        where: { tenant_id: tenantId },
      });
      expect(after).toEqual(before);
    },
  );

  // AUT-1007 Scenario 3 & Anti-criterion 2: PATCH without lock_date preserves existing lock_date
  it('keeps lock_date unchanged when OWNER patches fiscal_year_start_month only', async () => {
    const fixtureLockDate = new Date('2025-10-31T00:00:00.000Z');
    await request(app.getHttpServer())
      .patch('/finance/settings')
      .set('Authorization', roleHeaders.OWNER!)
      .send({
        fiscal_year_start_month: 1,
        lock_date: fixtureLockDate.toISOString(),
      })
      .expect(200);

    const response = await request(app.getHttpServer())
      .patch('/finance/settings')
      .set('Authorization', roleHeaders.OWNER!)
      .send({ fiscal_year_start_month: 5 })
      .expect(200);

    expect(response.body.fiscal_year_start_month).toBe(5);
    expect(new Date(response.body.lock_date).toISOString()).toBe(
      fixtureLockDate.toISOString(),
    );

    const saved = await prisma.financeSettings.findFirst({
      where: { tenant_id: tenantId },
    });
    expect(saved?.lock_date?.toISOString()).toBe(fixtureLockDate.toISOString());
  });

  // AUT-1007 Scenario 4: Explicit lock_date: null clears it and records an audit entry with old and new value
  it('clears lock_date when OWNER sends lock_date: null and writes audit entry with old and new value', async () => {
    const fixtureLockDate = new Date('2025-09-30T00:00:00.000Z');
    await request(app.getHttpServer())
      .patch('/finance/settings')
      .set('Authorization', roleHeaders.OWNER!)
      .send({ lock_date: fixtureLockDate.toISOString() })
      .expect(200);

    const response = await request(app.getHttpServer())
      .patch('/finance/settings')
      .set('Authorization', roleHeaders.OWNER!)
      .send({ lock_date: null })
      .expect(200);

    expect(response.body.lock_date).toBeNull();

    const saved = await prisma.financeSettings.findFirst({
      where: { tenant_id: tenantId },
    });
    expect(saved?.lock_date).toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        tenant_id: tenantId,
        entity_type: 'FinanceSettings',
        action: 'UPDATE',
      },
      orderBy: { occurred_at: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
    expect(
      (auditEntry?.before as { lock_date?: string | null } | null)?.lock_date,
    ).toBe(fixtureLockDate.toISOString());
    expect(
      (auditEntry?.after as { lock_date?: string | null } | null)?.lock_date,
    ).toBeNull();
  });

  // AUT-1002 Scenario 5: non-OWNER rejected (403, no audit entry); allowed change writes AuditLog with old/new values
  it('rejects non-OWNER changing bank_reconciliation_enabled with 403 and no audit entry, and audits allowed change', async () => {
    const beforeAuditCount = await prisma.auditLog.count({
      where: {
        tenant_id: tenantId,
        entity_type: 'FinanceSettings',
        action: 'UPDATE',
      },
    });

    for (const header of [roleHeaders.SALES!, roleHeaders.ADMIN!]) {
      await request(app.getHttpServer())
        .patch('/finance/settings')
        .set('Authorization', header)
        .send({ bank_reconciliation_enabled: true })
        .expect(403);
    }

    const afterRejectedAuditCount = await prisma.auditLog.count({
      where: {
        tenant_id: tenantId,
        entity_type: 'FinanceSettings',
        action: 'UPDATE',
      },
    });
    expect(afterRejectedAuditCount).toBe(beforeAuditCount);

    const allowedRes = await request(app.getHttpServer())
      .patch('/finance/settings')
      .set('Authorization', roleHeaders.OWNER!)
      .send({ bank_reconciliation_enabled: true })
      .expect(200);
    expect(allowedRes.body.bank_reconciliation_enabled).toBe(true);

    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        tenant_id: tenantId,
        entity_type: 'FinanceSettings',
        action: 'UPDATE',
      },
      orderBy: { occurred_at: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
    expect(
      (
        auditEntry?.before as {
          bank_reconciliation_enabled?: boolean;
        } | null
      )?.bank_reconciliation_enabled,
    ).toBe(false);
    expect(
      (
        auditEntry?.after as {
          bank_reconciliation_enabled?: boolean;
        } | null
      )?.bank_reconciliation_enabled,
    ).toBe(true);
  });

  // AUT-1008 Scenarios 2, 3, 4, 6 & Anti-criterion 2
  describe('Invoice numbering (AUT-1008)', () => {
    const originalWriterFlag = process.env.INVOICE_BRANDING_WRITER_ENABLED;
    let invoiceCustomerId: string;
    let catalogItemId: string;
    let siteId: string;
    let locationId: string;
    let firstInvoiceId: string;
    let firstInvoiceNumber: string;

    beforeAll(async () => {
      process.env.INVOICE_BRANDING_WRITER_ENABLED = 'true';
      await seedReadySellerAndAccountingProfile(prisma, tenantId, {
        includeVehicleMargin: true,
      });
      const customer = await seedInvoiceReadyCustomer(prisma, tenantId);
      invoiceCustomerId = customer.id;
      siteId = await resolveTestMainSiteId(prisma, tenantId);
      await request(app.getHttpServer())
        .patch('/me/active-site')
        .set('Authorization', authHeader)
        .send({ siteId })
        .expect(200);

      const catalogItem = await prisma.catalogItem.create({
        data: {
          tenant_id: tenantId,
          sku: `FIN-INV-${Date.now()}`,
          name: 'Finance Invoice Item',
          cost_price: 10,
          retail_price: 20,
        },
      });
      catalogItemId = catalogItem.id;

      const location = await prisma.storageLocation.create({
        data: {
          tenant_id: tenantId,
          code: `FIN-LOC-${Date.now()}`,
          name: 'Finance Test Location',
          type: 'warehouse',
          site_id: siteId,
        },
      });
      locationId = location.id;
      await prisma.inventoryStock.create({
        data: {
          tenant_id: tenantId,
          catalog_item_id: catalogItemId,
          site_id: siteId,
          location_id: location.id,
          quantity_on_hand: 50,
        },
      });
    });

    afterAll(() => {
      if (originalWriterFlag === undefined) {
        delete process.env.INVOICE_BRANDING_WRITER_ENABLED;
      } else {
        process.env.INVOICE_BRANDING_WRITER_ENABLED = originalWriterFlag;
      }
    });

    async function createAndFinalizeSalesInvoice() {
      const orderRes = await request(app.getHttpServer())
        .post('/sales-orders')
        .set('Authorization', authHeader)
        .send({
          customer_id: invoiceCustomerId,
          items: [
            {
              catalog_item_id: catalogItemId,
              description: 'Numbering test item',
              quantity: 1,
              unit_price: 20,
              tax_rate: 20,
            },
          ],
        })
        .expect(201);

      await prisma.salesOrder.updateMany({
        where: { id: orderRes.body.id },
        data: { status: 'CONFIRMED' },
      });

      const draftRes = await request(app.getHttpServer())
        .post(`/sales-orders/${orderRes.body.id}/create-invoice`)
        .set('Authorization', authHeader)
        .expect(201);

      const finalizeRes = await request(app.getHttpServer())
        .put(`/sales/invoices/${draftRes.body.id}/finalize`)
        .set('Authorization', authHeader)
        .expect(200);

      return finalizeRes.body as { id: string; invoice_number: string };
    }

    // Scenario 2: WHEN OWNER sets next_invoice_number to 4513 THEN the next invoice ends in 4513
    it('uses next_invoice_number set by OWNER (4513) for the next finalized invoice', async () => {
      await request(app.getHttpServer())
        .patch('/finance/settings')
        .set('Authorization', roleHeaders.OWNER!)
        .send({ next_invoice_number: 4513 })
        .expect(200);

      const finalized = await createAndFinalizeSalesInvoice();
      expect(finalized.invoice_number).toMatch(/4513$/);
      firstInvoiceId = finalized.id;
      firstInvoiceNumber = finalized.invoice_number;

      const settingsRes = await request(app.getHttpServer())
        .get('/finance/settings')
        .set('Authorization', roleHeaders.OWNER!)
        .expect(200);
      expect(settingsRes.body.next_invoice_number).toBe(4514);
    });

    // Scenario 3: WHEN OWNER sets it below or equal to the highest issued number THEN 409 and nothing changes
    it.each([4513, 4512])(
      'returns 409 and leaves settings and sequence unchanged when OWNER sets next_invoice_number to %i',
      async (invalidNext) => {
        const settingsBefore = await prisma.financeSettings.findFirst({
          where: { tenant_id: tenantId },
        });
        const sequenceBefore = await prisma.invoiceSequence.findFirst({
          where: { tenant_id: tenantId },
          orderBy: { year: 'desc' },
        });

        await request(app.getHttpServer())
          .patch('/finance/settings')
          .set('Authorization', roleHeaders.OWNER!)
          .send({ next_invoice_number: invalidNext })
          .expect(409);

        const settingsAfter = await prisma.financeSettings.findFirst({
          where: { tenant_id: tenantId },
        });
        const sequenceAfter = await prisma.invoiceSequence.findFirst({
          where: { tenant_id: tenantId },
          orderBy: { year: 'desc' },
        });
        expect(settingsAfter).toEqual(settingsBefore);
        expect(sequenceAfter).toEqual(sequenceBefore);
      },
    );

    // Scenario 4 & Anti-criterion 2: WHEN prefix changes THEN only new invoices use it; existing invoices are never renumbered
    it('applies a changed invoice_prefix only to newly numbered invoices without renumbering existing ones', async () => {
      await request(app.getHttpServer())
        .patch('/finance/settings')
        .set('Authorization', roleHeaders.OWNER!)
        .send({ invoice_prefix: 'INV-{YYYY}-' })
        .expect(200);

      const previousInvoice = await prisma.invoice.findFirst({
        where: { id: firstInvoiceId, tenant_id: tenantId },
        select: { invoice_number: true },
      });
      expect(previousInvoice?.invoice_number).toBe(firstInvoiceNumber);

      const nextFinalized = await createAndFinalizeSalesInvoice();
      expect(nextFinalized.invoice_number).toMatch(/^INV-\d{4}-4514$/);
    });

    // Scenario 6: WHEN a vehicle sale and a sales invoice finalize THEN both use the same sequence
    it('shares the same invoice sequence and prefix between sales invoices and vehicle sales', async () => {
      const salesInvoice = await createAndFinalizeSalesInvoice();
      const salesSeq = Number(salesInvoice.invoice_number.split('-').at(-1));

      const vehicle = await prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          location_id: locationId,
          make: 'VW',
          model: 'Golf',
          year: 2022,
          vin: `WVWZZZ1KZPW${Date.now().toString().slice(-6)}`,
          stock_status: 'IN_STOCK',
          inventory_role: 'USED',
        },
      });

      const saleRes = await request(app.getHttpServer())
        .post('/vehicle-sales')
        .set('Authorization', authHeader)
        .send({
          vehicle_id: vehicle.id,
          customer_id: invoiceCustomerId,
          sale_price: 15000,
        })
        .expect(201);

      const vehicleFinalized = await request(app.getHttpServer())
        .post(`/vehicle-sales/${saleRes.body.id}/finalize`)
        .set('Authorization', authHeader)
        .expect(201);

      const vehicleInvoiceNumber = vehicleFinalized.body.invoice
        .invoice_number as string;
      expect(vehicleInvoiceNumber).toBe(`INV-${salesInvoice.invoice_number.split('-')[1]}-${String(salesSeq + 1).padStart(4, '0')}`);
    });
  });
});
