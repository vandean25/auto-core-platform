import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTenantAwarePrisma,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

/** Legacy global unique indexes on tenant-scoped tables (pre–apply_multi_tenancy). */
export const LEGACY_GLOBAL_UNIQUE_INDEXES = [
  'revenue_groups_name_key',
  'catalog_items_sku_key',
  'labor_categories_name_key',
  'labor_operations_code_key',
  'inventory_stocks_catalog_item_id_key',
  'inventory_stocks_catalog_item_id_location_id_key',
  'invoices_invoice_number_key',
  'invoices_sales_order_id_key',
  'invoices_workshop_order_id_key',
  'purchase_invoices_invoice_number_key',
  'purchase_orders_order_number_key',
  'sales_orders_order_number_key',
  'workshop_orders_order_number_key',
] as const;

describe('Legacy global unique indexes (AUT-550)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantAPrisma: PrismaService;
  let tenantBPrisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let siteAId: string;
  let siteBId: string;

  const prefix = `e2e-aut550-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const tenantA = await createTestTenant(prisma, `${prefix}-a`);
    const tenantB = await createTestTenant(prisma, `${prefix}-b`);

    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    tenantAPrisma = createTenantAwarePrisma(prisma, tenantAId);
    tenantBPrisma = createTenantAwarePrisma(prisma, tenantBId);

    siteAId = await resolveTestMainSiteId(prisma, tenantAId);
    siteBId = await resolveTestMainSiteId(prisma, tenantBId);
  });

  afterAll(async () => {
    if (tenantAPrisma && tenantBPrisma) {
      await tenantAPrisma.salesOrder.deleteMany({
        where: { order_number: { startsWith: prefix } },
      });
      await tenantBPrisma.salesOrder.deleteMany({
        where: { order_number: { startsWith: prefix } },
      });
      await tenantAPrisma.customer.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await tenantBPrisma.customer.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await tenantAPrisma.laborOperation.deleteMany({
        where: { code: { startsWith: prefix } },
      });
      await tenantBPrisma.laborOperation.deleteMany({
        where: { code: { startsWith: prefix } },
      });
      await tenantAPrisma.laborCategory.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await tenantBPrisma.laborCategory.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await tenantAPrisma.catalogItem.deleteMany({
        where: { sku: { startsWith: prefix } },
      });
      await tenantBPrisma.catalogItem.deleteMany({
        where: { sku: { startsWith: prefix } },
      });
      await tenantAPrisma.revenueGroup.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await tenantBPrisma.revenueGroup.deleteMany({
        where: { name: { startsWith: prefix } },
      });
    }

    if (app) {
      await teardownTestApp(app, prisma);
    }
  });

  it('has no legacy global unique indexes on tenant-scoped business tables', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>(
      Prisma.sql`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (${Prisma.join([...LEGACY_GLOBAL_UNIQUE_INDEXES])})
      `,
    );

    expect(rows).toEqual([]);
  });

  it('allows two tenants to use the same SKU, revenue group name, labor name/code, and sales order number', async () => {
    const sharedSku = `${prefix}-SKU`;
    const sharedRevenueName = `${prefix}-REV`;
    const sharedLaborCategory = `${prefix}-LAB-CAT`;
    const sharedLaborCode = `${prefix}-LAB-OP`;
    const sharedOrderNumber = `${prefix}-SO-001`;

    await tenantAPrisma.revenueGroup.create({
      data: { tenant_id: tenantAId, name: sharedRevenueName },
    });
    await tenantBPrisma.revenueGroup.create({
      data: { tenant_id: tenantBId, name: sharedRevenueName },
    });

    await tenantAPrisma.catalogItem.create({
      data: {
        tenant_id: tenantAId,
        sku: sharedSku,
        name: 'Shared SKU item A',
        retail_price: 10,
      },
    });
    await tenantBPrisma.catalogItem.create({
      data: {
        tenant_id: tenantBId,
        sku: sharedSku,
        name: 'Shared SKU item B',
        retail_price: 10,
      },
    });

    await tenantAPrisma.laborCategory.create({
      data: { tenant_id: tenantAId, name: sharedLaborCategory },
    });
    await tenantBPrisma.laborCategory.create({
      data: { tenant_id: tenantBId, name: sharedLaborCategory },
    });

    await tenantAPrisma.laborOperation.create({
      data: {
        tenant_id: tenantAId,
        code: sharedLaborCode,
        description: 'Op A',
        standard_aw: 1,
        hourly_rate: 100,
      },
    });
    await tenantBPrisma.laborOperation.create({
      data: {
        tenant_id: tenantBId,
        code: sharedLaborCode,
        description: 'Op B',
        standard_aw: 1,
        hourly_rate: 100,
      },
    });

    const customerA = await tenantAPrisma.customer.create({
      data: {
        tenant_id: tenantAId,
        name: `${prefix}-cust-a`,
        email: `${prefix}-a@example.com`,
      },
    });
    const customerB = await tenantBPrisma.customer.create({
      data: {
        tenant_id: tenantBId,
        name: `${prefix}-cust-b`,
        email: `${prefix}-b@example.com`,
      },
    });

    await tenantAPrisma.salesOrder.create({
      data: {
        tenant_id: tenantAId,
        site_id: siteAId,
        order_number: sharedOrderNumber,
        customer_id: customerA.id,
        total_amount: 0,
      },
    });
    await tenantBPrisma.salesOrder.create({
      data: {
        tenant_id: tenantBId,
        site_id: siteBId,
        order_number: sharedOrderNumber,
        customer_id: customerB.id,
        total_amount: 0,
      },
    });
  });
});
