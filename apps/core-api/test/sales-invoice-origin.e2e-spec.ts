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
  createSalesInvoiceSuite,
  disposeSalesInvoiceSuite,
} from './helpers/sales-invoice-suite.js';

describe('SalesController (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;
  let legalEntityId: string;
  let customerId: string;
  let catalogItemId: string;

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      authToken,
      legalEntityId,
      customerId,
      catalogItemId,
    } = await createSalesInvoiceSuite());
  });

  afterAll(async () => {
    await disposeSalesInvoiceSuite({ app, basePrisma, prisma, tenantId });
  });

  it('/api/sales/invoices (POST) - rejects source-less draft creation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/sales/invoices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
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
      })
      .expect(400);

    expect(response.body.code).toBe('SOURCE_DOCUMENT_REQUIRED');
  });

  it.each(['default', 'confirmed'] as const)(
    'sales origin freezes %s branding before invoice effects',
    async (profileMode) => {
      const hasConfirmedProfile = profileMode === 'confirmed';
      const orderRes = await request(app.getHttpServer())
        .post('/api/sales-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customer_id: customerId,
          items: [
            {
              catalog_item_id: catalogItemId,
              description: 'Finalize Test Item',
              quantity: 1,
              unit_price: 100,
              tax_rate: 20,
            },
          ],
        })
        .expect(201);

      await prisma.salesOrder.updateMany({
        where: { id: orderRes.body.id },
        data: { status: 'CONFIRMED' },
      });

      const draftResponse = await request(app.getHttpServer())
        .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      const logo = hasConfirmedProfile
        ? await createReadyDocumentBrandLogo(
            prisma,
            tenantId,
            legalEntityId,
            `sales-${profileMode}`,
          )
        : null;
      let expectedProfileRevision = 0;
      if (logo) {
        const confirmedTheme = await confirmDocumentBrandTheme({
          app,
          authToken,
          legalEntityId,
          logoAssetId: logo.id,
          headerText: 'Sales profile before commitment',
        });
        expectedProfileRevision = confirmedTheme.body.activeRevision;
      }

      const invoiceSequenceBeforeDisabledCommit =
        await prisma.invoiceSequence.findFirst({
          where: { tenant_id: tenantId },
          select: { current: true },
        });
      await withInvoiceBrandingWriterDisabled(async () => {
        const disabledFinalize = await request(app.getHttpServer())
          .put(`/api/sales/invoices/${draftResponse.body.id}/finalize`)
          .set('Authorization', `Bearer ${authToken}`);
        expect(disabledFinalize.status).toBe(503);
        expect(disabledFinalize.body).toMatchObject({
          code: 'INVOICE_BRANDING_WRITER_DISABLED',
          message:
            'Invoice commitment is temporarily unavailable while branded invoice issuance is disabled.',
        });
      });
      const rejectedInvoice = await prisma.invoice.findFirstOrThrow({
        where: { id: draftResponse.body.id },
        select: { status: true, snapshot: true, invoice_number: true },
      });
      expect(rejectedInvoice).toMatchObject({
        status: 'DRAFT',
        snapshot: null,
        invoice_number: null,
      });
      expect(
        await prisma.salesOrder.findFirstOrThrow({
          where: { id: orderRes.body.id },
          select: { status: true },
        }),
      ).toMatchObject({ status: 'CONFIRMED' });
      expect(
        await prisma.invoiceSequence.findFirst({
          where: { tenant_id: tenantId },
          select: { current: true },
        }),
      ).toEqual(invoiceSequenceBeforeDisabledCommit);

      const finalizeResponse = await request(app.getHttpServer())
        .put(`/api/sales/invoices/${draftResponse.body.id}/finalize`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(finalizeResponse.body.status).toBe('FINALIZED');
      expect(finalizeResponse.body.invoice_number).toMatch(/^RE-\d{4}-\d{4}$/);
      for (const privateField of [
        'snapshot',
        'pdf_archive_bucket',
        'pdf_archive_key',
        'pdf_archive_generation',
        'pdf_archive_sha256',
        'pdf_storage_bucket',
        'pdf_storage_key',
      ]) {
        expect(finalizeResponse.body).not.toHaveProperty(privateField);
      }

      const committedInvoice = await prisma.invoice.findFirstOrThrow({
        where: { id: draftResponse.body.id },
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
        invoiceId: draftResponse.body.id,
        legalEntityId,
        logoAssetId: logo?.id ?? null,
      });
      const publicInvoice = await request(app.getHttpServer())
        .get(`/api/sales/invoices/${draftResponse.body.id}`)
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
        expect(publicInvoice.body).not.toHaveProperty(privateField);
      }
    },
  );
});
