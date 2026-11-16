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
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
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
    await prisma.inventoryStock.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
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
});
