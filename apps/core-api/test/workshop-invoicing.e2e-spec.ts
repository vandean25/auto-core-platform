import { randomUUID } from 'node:crypto';
import { AuthService } from '../src/auth/auth.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  confirmDocumentBrandTheme,
  createReadyDocumentBrandLogo,
  exerciseFrozenInvoiceArchiveLifecycle,
  installFakeInvoiceArchiveStorage,
  withInvoiceBrandingWriterDisabled,
} from './invoice-branding-archive-test-utils.js';

describe('Workshop Invoicing (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let customerId: string;
  let vehicleId: string;
  let tenantId: string;
  let legalEntityId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    installFakeInvoiceArchiveStorage(app);

    basePrisma = app.get<PrismaService>(PrismaService);
    prisma = basePrisma;

    const testTenant = await createTestTenant(prisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(prisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
    await seedReadySellerAndAccountingProfile(prisma, tenantId);
    legalEntityId = (
      await prisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantId },
        select: { id: true },
      })
    ).id;

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "invoice_items",
        "invoices",
        "workshop_task_line_items",
        "workshop_tasks",
        "workshop_orders",
        "vehicles",
        "customers",
        "invoice_sequences"
      CASCADE;
    `);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Workshop',
        last_name: 'Customer',
        email: `workshop-${Date.now()}@example.com`,
        type: 'PRIVATE',
        address_street: 'Werkstattstraße 1',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
      },
    });
    customerId = customer.id;
  });

  beforeEach(async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'BMW',
        model: 'X3',
        year: 2021,
        vin: `VIN-INV-${randomUUID()}`,
        customer_id: customerId,
      },
    });
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await basePrisma.$executeRawUnsafe(
      'DELETE FROM "invoice_brand_asset_references" WHERE "tenant_id" = $1',
      tenantId,
    );
    await prisma.documentBrandProfile.deleteMany();
    await prisma.documentBrandAsset.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.workshopTaskLineItem.deleteMany();
    await prisma.workshopTask.deleteMany();
    await prisma.workshopOrder.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.invoiceSequence.deleteMany();
    await teardownTestApp(app, prisma);
  });

  it.each(['default', 'confirmed'] as const)(
    'workshop origin freezes %s branding before invoice effects',
    async (profileMode) => {
    const hasConfirmedProfile = profileMode === 'confirmed';
    const api = request(app.getHttpServer());

    const orderRes = await api
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 120000,
        fuelLevel: 40,
        notes: 'Brake noise',
      })
      .expect(201);

    const orderId = orderRes.body.id;
    expect(orderRes.body.order_number).toMatch(/^WO-\d{4}-\d+$/);

    const taskRes = await api
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Replace brake pads' })
      .expect(201);

    const taskId = taskRes.body.id;

    await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-001',
            description: 'Brake labor',
            qty: 2,
            unitPrice: 80,
          },
        ],
      })
      .expect(200);

    const completedRes = await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    expect(completedRes.body.status).toBe('COMPLETED');

    const invoiceRes = await api
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderId })
      .expect(201);

    expect(invoiceRes.body.status).toBe('DRAFT');
    expect(invoiceRes.body.workshop_order_id).toBe(orderId);
    expect(invoiceRes.body.items).toHaveLength(1);

    const laborLine = invoiceRes.body.items.find(
      (item: any) => item.description === 'Brake labor',
    );
    expect(Number(laborLine.line_total)).toBeCloseTo(160);
    expect(Number(invoiceRes.body.total_net)).toBeCloseTo(160);
    expect(Number(invoiceRes.body.total_tax)).toBeCloseTo(32);
    expect(Number(invoiceRes.body.total_gross)).toBeCloseTo(192);

    const invoiceId = invoiceRes.body.id;
    const logo = hasConfirmedProfile
      ? await createReadyDocumentBrandLogo(
          prisma,
          tenantId,
          legalEntityId,
          `workshop-${profileMode}`,
        )
      : null;
    let expectedProfileRevision = 0;
    if (logo) {
      const confirmedTheme = await confirmDocumentBrandTheme({
        app,
        authToken,
        legalEntityId,
        logoAssetId: logo.id,
        headerText: 'Workshop profile before commitment',
      });
      expectedProfileRevision = confirmedTheme.body.activeRevision;
    }
    const invoiceSequenceBeforeDisabledCommit =
      await prisma.invoiceSequence.findFirst({
        where: { tenant_id: tenantId },
        select: { current: true },
      });
    await withInvoiceBrandingWriterDisabled(async () => {
      const disabledIssue = await api
        .patch(`/api/invoices/${invoiceId}/issue`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(disabledIssue.status).toBe(503);
      expect(disabledIssue.body).toMatchObject({
        code: 'INVOICE_BRANDING_WRITER_DISABLED',
      });
    });
    const rejectedInvoice = await prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId },
      select: { status: true, snapshot: true, invoice_number: true },
    });
    expect(rejectedInvoice).toMatchObject({
      status: 'DRAFT',
      snapshot: null,
      invoice_number: null,
    });
    expect(
      await prisma.workshopOrder.findFirstOrThrow({
        where: { id: orderId },
        select: { status: true },
      }),
    ).toMatchObject({ status: 'COMPLETED' });
    expect(
      await prisma.invoiceSequence.findFirst({
        where: { tenant_id: tenantId },
        select: { current: true },
      }),
    ).toEqual(invoiceSequenceBeforeDisabledCommit);
    const issueRes = await api
      .patch(`/api/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(issueRes.body.status).toBe('ISSUED');
    expect(issueRes.body.invoice_number).toMatch(/RE-\d{4}-\d{4}/);
    for (const privateField of [
      'snapshot',
      'pdf_archive_bucket',
      'pdf_archive_key',
      'pdf_archive_generation',
      'pdf_archive_sha256',
      'pdf_storage_bucket',
      'pdf_storage_key',
    ]) {
      expect(issueRes.body).not.toHaveProperty(privateField);
    }

    const committedInvoice = await prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId },
      select: { snapshot: true },
    });
    const snapshot = committedInvoice.snapshot as {
      schema_version: number;
      snapshot_created_at: string;
      template_version: string;
      branding: {
        schema_version: number;
        renderer_version: string;
        resolved_at: string;
        profile_id: string | null;
        profile_revision: number;
        preset_id: string;
        logo: { asset_id: string } | null;
      };
    };
    expect(snapshot.schema_version).toBe(2);
    expect(snapshot.template_version).toBe('invoice-brand-v1');
    expect(snapshot.branding).toMatchObject({
      schema_version: 1,
      renderer_version: 'invoice-brand-v1',
    });
    expect(snapshot.branding.resolved_at).toBe(snapshot.snapshot_created_at);
    expect(snapshot.branding.preset_id).toBe('standard-v1');
    expect(snapshot.branding.logo?.asset_id ?? null).toBe(logo?.id ?? null);
    if (hasConfirmedProfile) {
      expect(snapshot.branding.profile_id).toEqual(expect.any(String));
      expect(snapshot.branding.profile_revision).toBe(expectedProfileRevision);
    } else {
      expect(snapshot.branding.profile_id).toBeNull();
      expect(snapshot.branding.profile_revision).toBe(0);
    }

    await exerciseFrozenInvoiceArchiveLifecycle({
      app,
      prisma,
      authToken,
      invoiceId,
      legalEntityId,
      logoAssetId: logo?.id ?? null,
    });

    const publicOrder = await api
      .get(`/api/workshop/orders/${orderId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    for (const privateField of [
      'snapshot',
      'pdf_archive_bucket',
      'pdf_archive_key',
      'pdf_archive_generation',
      'pdf_archive_sha256',
      'pdf_storage_bucket',
      'pdf_storage_key',
    ]) {
      expect(publicOrder.body.invoice).not.toHaveProperty(privateField);
    }

    const lockedOrder = await prisma.workshopOrder.findFirst({
      where: { id: orderId },
    });
    expect(lockedOrder?.status).toBe('INVOICED');

    await api
      .patch(`/api/workshop/orders/${orderId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ notes: 'Attempt to edit after invoicing' })
      .expect(400);
    },
  );

  it('deletes a task, removes its line items, and recalculates the order status', async () => {
    const api = request(app.getHttpServer());

    const orderRes = await api
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 90000,
        fuelLevel: 55,
        notes: 'Service inspection',
      })
      .expect(201);

    const orderId = orderRes.body.id;

    const taskRes = await api
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Inspection task' })
      .expect(201);

    const taskId = taskRes.body.id;

    await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-INSPECT',
            description: 'Inspection labor',
            qty: 1,
            unitPrice: 65,
          },
        ],
      })
      .expect(200);

    const deleteRes = await api
      .delete(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(deleteRes.body.id).toBe(orderId);
    expect(deleteRes.body.status).toBe('INTAKE');
    expect(deleteRes.body.tasks).toHaveLength(0);

    const persistedTask = await prisma.workshopTask.findFirst({
      where: { id: taskId },
    });
    expect(persistedTask).toBeNull();

    const persistedLineItems = await prisma.workshopTaskLineItem.findMany({
      where: { workshop_task_id: taskId },
    });
    expect(persistedLineItems).toHaveLength(0);
  });

  it('blocks deleting a task after a draft invoice exists', async () => {
    const api = request(app.getHttpServer());

    const orderRes = await api
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 91000,
        fuelLevel: 50,
        notes: 'Draft invoice protection',
      })
      .expect(201);

    const orderId = orderRes.body.id;

    const taskRes = await api
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Invoice protected task' })
      .expect(201);

    const taskId = taskRes.body.id;

    await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-PROTECT',
            description: 'Protected labor',
            qty: 1,
            unitPrice: 25,
          },
        ],
      })
      .expect(200);

    await api
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    await api
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderId })
      .expect(201);

    const deleteRes = await api
      .delete(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);

    expect(deleteRes.body.message).toBe(
      'Workshop order already has an invoice; tasks cannot be deleted',
    );
  });
});
