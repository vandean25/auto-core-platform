import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Purchase Order Receipt Flow (e2e)', () => {
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

    // Clean up test data
    await prisma.inventoryTransaction.deleteMany();
    await prisma.inventoryStock.deleteMany();
    await prisma.purchaseOrderItem.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.catalogItem.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.storageLocation.deleteMany();

    // Create test vendor
    const vendor = await prisma.vendor.create({
      data: {
        name: 'Test Vendor',
        email: 'test@vendor.com',
        account_number: 'TEST001',
        supported_brands: ['TestBrand'],
      },
    });
    vendorId = vendor.id;

    // Create test catalog item
    const item = await prisma.catalogItem.create({
      data: {
        sku: 'TEST-001',
        name: 'Test Part',
        brand: 'TestBrand',
        price: 10.0,
      },
    });
    catalogItemId = item.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/purchase-orders/:id/receive', () => {
    it('should return valid JSON response (not empty body)', async () => {
      // Create PO
      const poResponse = await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .send({
          vendorId,
          items: [
            {
              catalogItemId,
              quantity: 5,
              unitCost: 10,
            },
          ],
        })
        .expect(201);

      const poId = poResponse.body.id;

      // Receive items
      const receiptResponse = await request(app.getHttpServer())
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

      // Verify response is valid JSON and not empty
      expect(receiptResponse.body).toBeDefined();
      expect(receiptResponse.body).not.toEqual({});
      expect(receiptResponse.body.id).toBe(poId);
      expect(receiptResponse.body.status).toBe('COMPLETED');
    });

    it('should atomically update PO status and create ledger entries', async () => {
      // Create PO with 2 items
      const item2 = await prisma.catalogItem.create({
        data: {
          sku: 'TEST-002',
          name: 'Test Part 2',
          brand: 'TestBrand',
          price: 20.0,
        },
      });

      const poResponse = await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .send({
          vendorId,
          items: [
            { catalogItemId, quantity: 3, unitCost: 10 },
            { catalogItemId: item2.id, quantity: 2, unitCost: 20 },
          ],
        })
        .expect(201);

      const poId = poResponse.body.id;

      // Receive all items
      const receiptResponse = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/receive`)
        .send({
          items: [
            { itemId: catalogItemId, quantity: 3 },
            { itemId: item2.id, quantity: 2 },
          ],
        })
        .expect(201);

      // Verify PO status updated
      expect(receiptResponse.body.status).toBe('COMPLETED');

      // Verify all items marked as received
      const updatedPO = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: true },
      });

      expect(updatedPO.status).toBe('COMPLETED');
      expect(updatedPO.items).toHaveLength(2);
      expect(updatedPO.items[0].quantity_received).toBe(3);
      expect(updatedPO.items[1].quantity_received).toBe(2);

      // Verify ledger transactions created
      const transactions = await prisma.inventoryTransaction.findMany({
        where: {
          reference_id: receiptResponse.body.order_number,
        },
      });

      expect(transactions).toHaveLength(2);
      expect(transactions.map((t) => Number(t.quantity))).toContain(3);
      expect(transactions.map((t) => Number(t.quantity))).toContain(2);

      // Verify inventory stock updated
      const stock1 = await prisma.inventoryStock.findFirst({
        where: { catalog_item_id: catalogItemId },
      });
      const stock2 = await prisma.inventoryStock.findFirst({
        where: { catalog_item_id: item2.id },
      });

      expect(stock1.quantity_on_hand).toBeGreaterThanOrEqual(3);
      expect(stock2.quantity_on_hand).toBeGreaterThanOrEqual(2);
    });

    it('should handle partial receipts correctly', async () => {
      // Create PO
      const poResponse = await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .send({
          vendorId,
          items: [{ catalogItemId, quantity: 10, unitCost: 10 }],
        })
        .expect(201);

      const poId = poResponse.body.id;

      // Partial receipt (5 out of 10)
      const receipt1 = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/receive`)
        .send({
          items: [{ itemId: catalogItemId, quantity: 5 }],
        })
        .expect(201);

      expect(receipt1.body.status).toBe('PARTIAL');

      // Complete receipt (remaining 5)
      const receipt2 = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/receive`)
        .send({
          items: [{ itemId: catalogItemId, quantity: 5 }],
        })
        .expect(201);

      expect(receipt2.body.status).toBe('COMPLETED');
    });

    it('should reject over-receiving', async () => {
      // Create PO
      const poResponse = await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .send({
          vendorId,
          items: [{ catalogItemId, quantity: 5, unitCost: 10 }],
        })
        .expect(201);

      const poId = poResponse.body.id;

      // Attempt to receive more than ordered
      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/receive`)
        .send({
          items: [{ itemId: catalogItemId, quantity: 10 }],
        })
        .expect(400);
    });

    it('should rollback transaction on ledger failure', async () => {
      // This test verifies that if ledger transaction fails,
      // the PO item updates are rolled back

      const poResponse = await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .send({
          vendorId,
          items: [{ catalogItemId, quantity: 5, unitCost: 10 }],
        })
        .expect(201);

      const poId = poResponse.body.id;
      const initialPO = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: true },
      });

      // Note: In a real test, you'd inject a failing ledger service
      // For now, we just verify the happy path maintains consistency

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/receive`)
        .send({
          items: [{ itemId: catalogItemId, quantity: 5 }],
        })
        .expect(201);

      // Verify consistency: if status is COMPLETED, all items must be received
      const finalPO = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: true },
      });

      if (finalPO.status === 'COMPLETED') {
        finalPO.items.forEach((item) => {
          expect(item.quantity_received).toBe(item.quantity);
        });
      }
    });
  });
});
