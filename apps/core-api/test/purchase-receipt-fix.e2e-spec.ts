import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Purchase Receipt Fix Verification (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let vendorId: string;
    let catalogItemId: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        prisma = app.get<PrismaService>(PrismaService);

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
        }

        // Create test brand
        const brandName = 'TestBrand-' + Date.now();
        const brand = await prisma.brand.create({
            data: { name: brandName }
        });

        // Create test vendor
        const vendor = await prisma.vendor.create({
            data: {
                name: 'Test Vendor Fix',
                email: 'test-fix-' + Date.now() + '@vendor.com',
                account_number: 'TEST-' + Date.now(),
                supportedBrands: {
                    connect: { id: brand.id }
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
        await app.close();
    });

    describe('Receipt Flow with Inventory Stock Fix', () => {
        it('should successfully receive items and CREATE inventory stock (first receipt)', async () => {
            // 1. Create PO
            const poResponse = await request(app.getHttpServer())
                .post('/api/purchase-orders')
                .send({
                    vendor_id: vendorId,
                    items: [
                        {
                            catalog_item_id: catalogItemId,
                            quantity: 10,
                            unit_cost: 10,
                        },
                    ],
                })
                .expect(201);

            const poId = poResponse.body.id;

            // 2. Receive 5 items (PARTIAL)
            await request(app.getHttpServer())
                .post(`/api/purchase-orders/${poId}/receive`)
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
            // 1. Create another PO
            const poResponse = await request(app.getHttpServer())
                .post('/api/purchase-orders')
                .send({
                    vendor_id: vendorId,
                    items: [
                        {
                            catalog_item_id: catalogItemId,
                            quantity: 5,
                            unit_cost: 10,
                        },
                    ],
                })
                .expect(201);

            const poId = poResponse.body.id;

            // 2. Receive 5 items
            await request(app.getHttpServer())
                .post(`/api/purchase-orders/${poId}/receive`)
                .send({
                    items: [
                        {
                            itemId: catalogItemId,
                            quantity: 5,
                        },
                    ],
                })
                .expect(201);

            // 3. Verify InventoryStock was updated (5 from prev test + 5 from this test = 10)
            const stock = await prisma.inventoryStock.findFirst({
                where: { catalog_item_id: catalogItemId },
            });

            expect(stock).toBeDefined();
            expect(stock?.quantity_on_hand).toBe(10);
        });
    });
});
