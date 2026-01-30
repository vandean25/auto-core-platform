import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('PurchaseInvoice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let vendorId: string;
  let catalogItemId: string;
  let purchaseOrderId: string;
  let purchaseOrderItemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // Setup Test Data
    const vendor = await prisma.vendor.create({
      data: {
        name: 'Test Invoice Vendor',
        email: `invoice-vendor-${Date.now()}@example.com`,
        account_number: 'INV123',
      },
    });
    vendorId = vendor.id;

    const catalogItem = await prisma.catalogItem.create({
      data: {
        sku: `PI-TEST-ITEM-${Date.now()}`,
        name: 'Invoice Test Item',
        cost_price: 10,
        retail_price: 20,
      },
    });
    catalogItemId = catalogItem.id;

    // Create PO and Receive Items
    const po = await prisma.purchaseOrder.create({
      data: {
        vendor_id: vendorId,
        order_number: `PO-INV-${Date.now()}`,
        status: 'COMPLETED', // Simulating received
        items: {
            create: {
                catalog_item_id: catalogItemId,
                quantity: 10,
                quantity_received: 10, // Full receipt
                unit_cost: 10,
            }
        }
      },
      include: { items: true }
    });
    purchaseOrderId = po.id;
    purchaseOrderItemId = po.items[0].id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.purchaseInvoiceLine.deleteMany();
    await prisma.purchaseInvoice.deleteMany();
    await prisma.purchaseOrderItem.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.catalogItem.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.brand.deleteMany();
    await app.close();
  });

  it('/vendors/:id/unbilled-receipts (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get(`/vendors/${vendorId}/unbilled-receipts`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].purchaseOrderItemId).toBe(purchaseOrderItemId);
    expect(response.body[0].quantityPending).toBe(10);
  });

  it('/purchase-invoices (POST) - Create Draft', async () => {
    const createDto = {
      vendorId: vendorId,
      vendorInvoiceNumber: 'INV-001',
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      items: [
        {
          purchaseOrderItemId: purchaseOrderItemId,
          description: 'Invoice Test Item',
          quantity: 5,
          unitPrice: 10,
        },
      ],
    };

    const response = await request(app.getHttpServer())
        .post('/purchase-invoices')
        .send(createDto)
        .expect(201);
    
    expect(response.body.status).toBe('DRAFT');
    expect(response.body.total_amount).toBe('50');

    // Verify PO Item updated
    const poItem = await prisma.purchaseOrderItem.findUnique({
        where: { id: purchaseOrderItemId }
    });
    expect(Number(poItem?.quantity_invoiced)).toBe(5);
  });

  it('/vendors/:id/unbilled-receipts (GET) - Check Remaining', async () => {
    const response = await request(app.getHttpServer())
      .get(`/vendors/${vendorId}/unbilled-receipts`)
      .expect(200);

    expect(response.body[0].quantityPending).toBe(5); // 10 received - 5 invoiced
  });

  it('/purchase-invoices (POST) - Prevent Over-Invoicing', async () => {
    const createDto = {
        vendorId: vendorId,
        vendorInvoiceNumber: 'INV-002',
        invoiceDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        items: [
          {
            purchaseOrderItemId: purchaseOrderItemId,
            description: 'Over Invoice Item',
            quantity: 6, // Only 5 pending
            unitPrice: 10,
          },
        ],
      };
  
      await request(app.getHttpServer())
          .post('/purchase-invoices')
          .send(createDto)
          .expect(400);
  });

  it('Post Invoice', async () => {
      // Create another draft first
      const createDto = {
        vendorId: vendorId,
        vendorInvoiceNumber: 'INV-003',
        invoiceDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        items: [
          {
            purchaseOrderItemId: purchaseOrderItemId,
            description: 'Post Test Item',
            quantity: 5,
            unitPrice: 10,
          },
        ],
      };

      const draft = await request(app.getHttpServer())
        .post('/purchase-invoices')
        .send(createDto)
        .expect(201);
      
      const response = await request(app.getHttpServer())
        .patch(`/purchase-invoices/${draft.body.id}/post`)
        .expect(200);

      expect(response.body.status).toBe('POSTED');
  });

  it('Prevent Posting Empty Invoice', async () => {
    // Create an invoice without lines (if possible via API, though DTO usually prevents this)
    // Actually, CreatePurchaseInvoiceDto has items array, but let's assume we bypass or it's empty
    const createDto = {
      vendorId: vendorId,
      vendorInvoiceNumber: 'INV-EMPTY',
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      items: [],
    };

    const draft = await request(app.getHttpServer())
      .post('/purchase-invoices')
      .send(createDto)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/purchase-invoices/${draft.body.id}/post`)
      .expect(400);
  });
});
