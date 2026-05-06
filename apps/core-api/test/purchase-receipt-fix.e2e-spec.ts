import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantAwarePrisma, createTestTenant } from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Purchase Receipt Fix Verification (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  let vendorId: string;
  let catalogItemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const testTenant = await createTestTenant(prisma);
    prisma = createTenantAwarePrisma(prisma, testTenant.tenantId);
    authToken = app.get(AuthService).createTestToken({ tenantId: testTenant.tenantId });

    // Clean up test data using TRUNCATE CASCADE to avoid FK hell
    try {
      await prisma.$executeRawUnsafe(`
            TRUNCATE TABLE 
                "inventory_transactions",
                "inventory_stocks",
                "purchase_invoice_lines",
                "purchase_invoices",
                "purchase_order_items",
                "purchase_orders",
                "vendors",
                "invoice_items",
                "invoices",
                "catalog_items",
                "storage_locations",
                "brands"
            CASCADE;
        `);
    } catch (error) {
      console.error('Cleanup failed:', error);
      throw error; // Fail early
    }

    // Create test brand
    const brandName = 'TestBrand-' + Date.now();
    const brand = await prisma.brand.create({
      data: { name: brandName },
    });

    // Create test vendor
    const vendor = await prisma.vendor.create({
      data: {
        name: 'Test Vendor Fix',
        email: 'test-fix-' + Date.now() + '@vendor.com',
        account_number: 'TEST-' + Date.now(),
        supportedBrands: {
          connect: { id: brand.id },
        },
      },
    });
    vendorId = vendor.id;

    // Create test catalog item
    const item = await prisma.catalogItem.create({
      data: {
        sku: 'TEST-FIX-001-' + Date.now(),
        name: 'Test Part Fix',
        unit: 'pcs',
        cost_price: 10.0,
        retail_price: 20.0,
      },
    });
    catalogItemId = item.id;
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  describe('Receipt Flow with Inventory Stock Fix', () => {
    it('should successfully receive items and CREATE inventory stock (first receipt)', async () => {
      // 1. Create PO
      const poResponse = await request(app.getHttpServer())
        .post('/api/purchase-orders')
          .set('Authorization', `Bearer \${authToken}`)
        .send({
          vendorId: vendorId,
          items: [
            {
              catalogItemId: catalogItemId,
              quantity: 10,
              unitCost: 10,
            },
          ],
        })
        .expect(201);

      const poId = poResponse.body.id;

      // 2. Receive 5 items (PARTIAL)
      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/receive`)
          .set('Authorization', `Bearer \${authToken}`)
        .send({
          items: [
            {
              itemId: catalogItemId,
              quantity: 5,
            },
          ],
        })
        .expect(201);

      // 3. Verify InventoryStock was created
      const stock = await prisma.inventoryStock.findFirst({
        where: { catalog_item_id: catalogItemId },
      });

      expect(stock).toBeDefined();
      expect(stock?.quantity_on_hand).toBe(5);
    });

    it('should successfully receive additional items and UPDATE inventory stock (second receipt)', async () => {
      // Create a fresh catalog item for this test to ensure isolation
      const freshItem = await prisma.catalogItem.create({
        data: {
          sku: 'TEST-FIX-002-' + Date.now(),
          name: 'Test Part Fix 2',
          unit: 'pcs',
          cost_price: 15.0,
          retail_price: 30.0,
        },
      });
      const freshItemId = freshItem.id;

      // 1. Create first PO and receive 5 items to establish initial stock
      const po1Response = await request(app.getHttpServer())
        .post('/api/purchase-orders')
          .set('Authorization', `Bearer \${authToken}`)
        .send({
          vendorId: vendorId,
          items: [
            {
              catalogItemId: freshItemId,
              quantity: 5,
              unitCost: 15,
            },
          ],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${po1Response.body.id}/receive`)
          .set('Authorization', `Bearer \${authToken}`)
        .send({
          items: [{ itemId: freshItemId, quantity: 5 }],
        })
        .expect(201);

      // 2. Create another PO and receive more items for the same catalog item
      const po2Response = await request(app.getHttpServer())
        .post('/api/purchase-orders')
          .set('Authorization', `Bearer \${authToken}`)
        .send({
          vendorId: vendorId,
          items: [
            {
              catalogItemId: freshItemId,
              quantity: 5,
              unitCost: 15,
            },
          ],
        })
        .expect(201);

      const po2Id = po2Response.body.id;

      // Receive 5 more items
      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${po2Id}/receive`)
          .set('Authorization', `Bearer \${authToken}`)
        .send({
          items: [
            {
              itemId: freshItemId,
              quantity: 5,
            },
          ],
        })
        .expect(201);

      // 3. Verify InventoryStock was updated (5 from first receipt + 5 from second = 10)
      const stock = await prisma.inventoryStock.findFirst({
        where: { catalog_item_id: freshItemId },
      });

      expect(stock).toBeDefined();
      expect(stock?.quantity_on_hand).toBe(10);
    });
  });
});
