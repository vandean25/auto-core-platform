import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { createTenantAwarePrisma, createTestTenant } from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('PurchaseInvoice (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
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
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    const testTenant = await createTestTenant(prisma);
    prisma = createTenantAwarePrisma(prisma, testTenant.tenantId);
    authToken = app.get(AuthService).createTestToken({ tenantId: testTenant.tenantId });

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
          },
        },
      },
      include: { items: true },
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
    await teardownTestApp(app, prisma);
  });

  it('/vendors/:id/unbilled-receipts (GET)', async () => {
    // Reset for isolation
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 0 },
    });

    const response = await request(app.getHttpServer())
      .get(`/vendors/${vendorId}/unbilled-receipts`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].purchaseOrderItemId).toBe(purchaseOrderItemId);
    expect(response.body[0].quantityPending).toBe(10);
  });

  it('/purchase-invoices (POST) - Create Draft', async () => {
    // Reset for isolation
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 0 },
    });

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
        .set('Authorization', `Bearer ${authToken}`)
      .send(createDto)
      .expect(201);

    expect(response.body.status).toBe('DRAFT');
    expect(response.body.total_amount).toBe('50');

    // Verify PO Item updated
    const poItem = await prisma.purchaseOrderItem.findUnique({
      where: { id: purchaseOrderItemId },
    });
    expect(Number(poItem?.quantity_invoiced)).toBe(5);
  });

  it('/vendors/:id/unbilled-receipts (GET) - Check Remaining', async () => {
    // Make this test deterministic by setting the state it expects
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 5 },
    });

    const response = await request(app.getHttpServer())
      .get(`/vendors/${vendorId}/unbilled-receipts`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body[0].quantityPending).toBe(5); // 10 received - 5 invoiced
  });

  it('/purchase-invoices (POST) - Prevent Over-Invoicing', async () => {
    // Ensure we start with 5 already invoiced
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 5 },
    });

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
        .set('Authorization', `Bearer ${authToken}`)
      .send(createDto)
      .expect(400);
  });

  it('Post Invoice', async () => {
    // Reset for isolation
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 0 },
    });

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
        .set('Authorization', `Bearer ${authToken}`)
      .send(createDto)
      .expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/purchase-invoices/${draft.body.id}/post`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.status).toBe('POSTED');
  });

  it('Prevent Posting Empty Invoice', async () => {
    const createDto = {
      vendorId: vendorId,
      vendorInvoiceNumber: 'INV-EMPTY',
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      items: [],
    };

    const draft = await request(app.getHttpServer())
      .post('/purchase-invoices')
        .set('Authorization', `Bearer ${authToken}`)
      .send(createDto)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/purchase-invoices/${draft.body.id}/post`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });

  it('Pay Invoice', async () => {
    // Reset for isolation
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 0 },
    });

    // Create and Post an invoice first
    const createDto = {
      vendorId: vendorId,
      vendorInvoiceNumber: 'INV-PAY-TEST',
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      items: [
        {
          purchaseOrderItemId: purchaseOrderItemId,
          description: 'Pay Test Item',
          quantity: 1,
          unitPrice: 10,
        },
      ],
    };

    const draft = await request(app.getHttpServer())
      .post('/purchase-invoices')
        .set('Authorization', `Bearer ${authToken}`)
      .send(createDto)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/purchase-invoices/${draft.body.id}/post`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const response = await request(app.getHttpServer())
      .patch(`/purchase-invoices/${draft.body.id}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.status).toBe('PAID');
  });

  it('Delete Draft Invoice and Restore PO Item Quantities', async () => {
    // Reset for isolation
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 0 },
    });

    // 1. Check current quantity_invoiced
    const poItemBefore = await prisma.purchaseOrderItem.findUnique({
      where: { id: purchaseOrderItemId },
    });
    const qtyBefore = Number(poItemBefore?.quantity_invoiced);

    // 2. Create a Draft invoice (increments quantity_invoiced)
    const createDto = {
      vendorId: vendorId,
      vendorInvoiceNumber: 'INV-DELETE-TEST',
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      items: [
        {
          purchaseOrderItemId: purchaseOrderItemId,
          description: 'Delete Test Item',
          quantity: 2,
          unitPrice: 10,
        },
      ],
    };

    const draft = await request(app.getHttpServer())
      .post('/purchase-invoices')
        .set('Authorization', `Bearer ${authToken}`)
      .send(createDto)
      .expect(201);

    const poItemAfterCreate = await prisma.purchaseOrderItem.findUnique({
      where: { id: purchaseOrderItemId },
    });
    expect(Number(poItemAfterCreate?.quantity_invoiced)).toBe(qtyBefore + 2);

    // 3. Delete the Draft invoice (decrements quantity_invoiced)
    await request(app.getHttpServer())
      .delete(`/purchase-invoices/${draft.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const poItemAfterDelete = await prisma.purchaseOrderItem.findUnique({
      where: { id: purchaseOrderItemId },
    });
    expect(Number(poItemAfterDelete?.quantity_invoiced)).toBe(qtyBefore);
  });

  it('Prevent Deleting Posted Invoice', async () => {
    // Reset for isolation
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 0 },
    });

    const createDto = {
      vendorId: vendorId,
      vendorInvoiceNumber: 'INV-DELETE-POSTED-TEST',
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      items: [
        {
          purchaseOrderItemId: purchaseOrderItemId,
          description: 'Delete Posted Item',
          quantity: 1,
          unitPrice: 10,
        },
      ],
    };

    const draft = await request(app.getHttpServer())
      .post('/purchase-invoices')
        .set('Authorization', `Bearer ${authToken}`)
      .send(createDto)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/purchase-invoices/${draft.body.id}/post`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/purchase-invoices/${draft.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });

  it('Update Invoice (PATCH :id)', async () => {
    // Reset for isolation
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 0 },
    });

    // Capture initial state
    const poItemInitial = await prisma.purchaseOrderItem.findUnique({
      where: { id: purchaseOrderItemId },
    });
    const initialQty = Number(poItemInitial?.quantity_invoiced);

    // 1. Create a Draft
    const createDto = {
      vendorId: vendorId,
      vendorInvoiceNumber: 'INV-UPDATE-TEST',
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      items: [
        {
          purchaseOrderItemId: purchaseOrderItemId,
          description: 'Original Item',
          quantity: 1,
          unitPrice: 10,
        },
      ],
    };

    const draft = await request(app.getHttpServer())
      .post('/purchase-invoices')
        .set('Authorization', `Bearer ${authToken}`)
      .send(createDto)
      .expect(201);

    // 2. Update it
    const updateDto = {
      ...createDto,
      vendorInvoiceNumber: 'INV-UPDATE-TEST-MODIFIED',
      items: [
        {
          purchaseOrderItemId: purchaseOrderItemId,
          description: 'Updated Item',
          quantity: 2, // Increment quantity
          unitPrice: 15,
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .patch(`/purchase-invoices/${draft.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
      .send(updateDto)
      .expect(200);

    expect(response.body.vendor_invoice_number).toBe(
      'INV-UPDATE-TEST-MODIFIED',
    );
    expect(response.body.lines).toHaveLength(1);
    expect(response.body.lines[0].description).toBe('Updated Item');
    expect(Number(response.body.lines[0].quantity)).toBe(2);

    // 3. Verify PO item quantity_invoiced was updated correctly (0 -> 1 -> 2)
    const poItemFinal = await prisma.purchaseOrderItem.findUnique({
      where: { id: purchaseOrderItemId },
    });
    expect(Number(poItemFinal?.quantity_invoiced)).toBe(initialQty + 2);
  });

  it('Delete Invoice Line (DELETE :id/lines/:lineId)', async () => {
    // Reset for isolation
    await prisma.purchaseOrderItem.update({
      where: { id: purchaseOrderItemId },
      data: { quantity_invoiced: 0 },
    });

    // 1. Create a Draft with 2 lines
    const createDto = {
      vendorId: vendorId,
      vendorInvoiceNumber: 'INV-LINE-DELETE-TEST',
      invoiceDate: new Date().toISOString(),
      dueDate: new Date().toISOString(),
      items: [
        {
          purchaseOrderItemId: purchaseOrderItemId,
          description: 'Line 1',
          quantity: 1,
          unitPrice: 10,
        },
        {
          description: 'Manual Line',
          quantity: 1,
          unitPrice: 5,
        },
      ],
    };

    const draft = await request(app.getHttpServer())
      .post('/purchase-invoices')
        .set('Authorization', `Bearer ${authToken}`)
      .send(createDto)
      .expect(201);

    const lineToDelete = draft.body.lines.find(
      (l: any) => l.purchase_order_item_id === purchaseOrderItemId,
    );
    expect(lineToDelete).toBeDefined();

    // 2. Delete one line
    await request(app.getHttpServer())
      .delete(`/purchase-invoices/${draft.body.id}/lines/${lineToDelete.id}`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // 3. Verify remaining state
    const updated = await request(app.getHttpServer())
      .get(`/purchase-invoices/${draft.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(updated.body.lines).toHaveLength(1);
    expect(Number(updated.body.total_amount)).toBe(5); // Only manual line remains

    // 4. Verify PO item quantity_invoiced was restored
    const poItem = await prisma.purchaseOrderItem.findUnique({
      where: { id: purchaseOrderItemId },
    });
    expect(Number(poItem?.quantity_invoiced)).toBe(0);
  });
});
