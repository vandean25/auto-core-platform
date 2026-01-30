import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('SalesController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerId: string;
  let catalogItemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // Setup Test Data
    const customer = await prisma.customer.create({
      data: {
        name: 'Test Customer',
        email: `test-${Date.now()}@example.com`,
      },
    });
    customerId = customer.id;

    const catalogItem = await prisma.catalogItem.create({
      data: {
        sku: `TEST-ITEM-${Date.now()}`,
        name: 'Test Item',
        cost_price: 10,
        retail_price: 20,
      },
    });
    catalogItemId = catalogItem.id;

    // Create Stock
    const location = await prisma.storageLocation.create({
      data: {
        name: 'Test Location',
        type: 'warehouse',
      },
    });

    await prisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItemId,
        location_id: location.id,
        quantity_on_hand: 100,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.inventoryTransaction.deleteMany();
    await prisma.inventoryStock.deleteMany();
    await prisma.storageLocation.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.catalogItem.deleteMany();
    await prisma.revenueGroup.deleteMany();
    await prisma.brand.deleteMany();
    await app.close();
  });

  it('/sales/invoices (POST) - Create Draft', async () => {
    const createInvoiceDto = {
      customerId: customerId,
      items: [
        {
          catalogItemId: catalogItemId,
          description: 'Test Item Snapshot',
          quantity: 2,
          unitPrice: 20,
          taxRate: 20,
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post('/sales/invoices')
      .send(createInvoiceDto)
      .expect(201);

    expect(response.body.status).toBe('DRAFT');
    expect(response.body.total_net).toBe('40'); // 2 * 20
    expect(response.body.invoice_number).toBeNull();
  });

  it('Finalize Invoice Workflow', async () => {
     // 1. Create Draft
     const createInvoiceDto = {
        customerId: customerId,
        items: [
          {
            catalogItemId: catalogItemId,
            description: 'Finalize Test Item',
            quantity: 1,
            unitPrice: 100,
            taxRate: 0,
          },
        ],
      };
  
      const draftResponse = await request(app.getHttpServer())
        .post('/sales/invoices')
        .send(createInvoiceDto)
        .expect(201);
      
      const invoiceId = draftResponse.body.id;

      // 2. Finalize
      const finalizeResponse = await request(app.getHttpServer())
        .put(`/sales/invoices/${invoiceId}/finalize`)
        .expect(200);

      expect(finalizeResponse.body.status).toBe('FINALIZED');
      expect(finalizeResponse.body.invoice_number).toMatch(/^RE-\d{4}-\d{4}$/);
  });
});
