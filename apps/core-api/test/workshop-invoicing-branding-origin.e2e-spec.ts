import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  confirmDocumentBrandTheme,
  createReadyDocumentBrandLogo,
  exerciseFrozenInvoiceArchiveLifecycle,
  withInvoiceBrandingWriterDisabled,
} from './invoice-branding-archive-test-utils.js';
import {
  createWorkshopInvoicingSuite,
  createWorkshopVehicle,
  disposeWorkshopInvoicingSuite,
} from './helpers/workshop-invoicing-suite.js';

describe('Workshop Invoicing (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;
  let legalEntityId: string;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      authToken,
      legalEntityId,
      customerId,
    } = await createWorkshopInvoicingSuite());
  });

  afterAll(async () => {
    await disposeWorkshopInvoicingSuite({ app, basePrisma, prisma, tenantId });
  });

  beforeEach(async () => {
    vehicleId = await createWorkshopVehicle(prisma, customerId);
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
        expect(snapshot.branding.profile_revision).toBe(
          expectedProfileRevision,
        );
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
});
