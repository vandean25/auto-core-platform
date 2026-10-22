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
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';
import type { VehicleStockSuite } from './helpers/vehicle-stock-suite.js';

describe('Vehicle stock trading (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let authToken: string;
  let buyerId: string;
  let legalEntityId: string;
  let archiveReadKeys: string[];
  let createAndReceive: VehicleStockSuite['createAndReceive'];
  let createAdditionalLotSite: VehicleStockSuite['createAdditionalLotSite'];

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      otherTenantId,
      authToken,
      buyerId,
      legalEntityId,
      archiveReadKeys,
      createAndReceive,
      createAdditionalLotSite,
    } = await createVehicleStockSuite());
  });

  afterAll(async () => {
    await disposeVehicleStockSuite({
      app,
      basePrisma,
      prisma,
      tenantId,
      otherTenantId,
    });
  });

  it.each(['default', 'confirmed'] as const)(
    'vehicle-sale origin freezes %s branding before invoice effects',
    async (profileMode) => {
      const hasConfirmedProfile = profileMode === 'confirmed';
      const { received } = await createAndReceive({
        vin: vin(hasConfirmedProfile ? 'SALE02' : 'SALE01'),
        sellerType: 'VENDOR',
        price: 10000,
      });
      const vehicleId = received.vehicle_id as string;

      const salePayload = {
        vehicle_id: vehicleId,
        customer_id: buyerId,
        sale_price: 12000,
      };
      const saleRes = await request(app.getHttpServer())
        .post('/api/vehicle-sales')
        .set('Authorization', `Bearer ${authToken}`)
        .send(salePayload)
        .expect(201);

      const preview = await request(app.getHttpServer())
        .get(`/api/vehicle-sales/${saleRes.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(Number(preview.body.margin_vat_preview)).toBe(333.33);

      const draftSaleBeforeNova = await prisma.vehicleSale.findFirstOrThrow({
        where: { id: saleRes.body.id },
        select: {
          vehicle_id: true,
          customer_id: true,
          sale_price: true,
          status: true,
        },
      });
      await request(app.getHttpServer())
        .post('/api/vehicles/nova/calculate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          co2GramsPerKm: 150,
          emissionCycle: 'WLTP',
          netPriceEuro: 10000,
          driveType: 'ICE',
          taxableEventDate: '2026-10-06',
          vehicleClass: 'passenger_z3',
        })
        .expect(200);
      const draftSaleAfterNova = await prisma.vehicleSale.findFirstOrThrow({
        where: { id: saleRes.body.id },
        select: {
          vehicle_id: true,
          customer_id: true,
          sale_price: true,
          status: true,
        },
      });
      expect(JSON.stringify(draftSaleAfterNova)).toBe(
        JSON.stringify(draftSaleBeforeNova),
      );
      expect(JSON.stringify(salePayload)).toBe(
        '{"vehicle_id":"' +
          vehicleId +
          '","customer_id":"' +
          buyerId +
          '","sale_price":12000}',
      );

      const logo = hasConfirmedProfile
        ? await createReadyDocumentBrandLogo(
            prisma,
            tenantId,
            legalEntityId,
            `vehicle-sale-${profileMode}`,
          )
        : null;
      let expectedProfileRevision = 0;
      if (logo) {
        const confirmedTheme = await confirmDocumentBrandTheme({
          app,
          authToken,
          legalEntityId,
          logoAssetId: logo.id,
          headerText: 'Vehicle sale profile before commitment',
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
          .post(`/api/vehicle-sales/${saleRes.body.id}/finalize`)
          .set('Authorization', `Bearer ${authToken}`);
        expect(disabledFinalize.status).toBe(503);
        expect(disabledFinalize.body).toMatchObject({
          code: 'INVOICE_BRANDING_WRITER_DISABLED',
        });
      });
      const rejectedSale = await prisma.vehicleSale.findFirstOrThrow({
        where: { id: saleRes.body.id },
        select: { status: true, invoice: { select: { id: true } } },
      });
      const unreleasedVehicle = await prisma.vehicle.findFirstOrThrow({
        where: { id: vehicleId },
        select: { stock_status: true, customer_id: true },
      });
      expect(rejectedSale).toMatchObject({ status: 'DRAFT', invoice: null });
      expect(unreleasedVehicle.stock_status).toBe('IN_STOCK');
      expect(unreleasedVehicle.customer_id).toBeNull();
      expect(
        await prisma.invoiceSequence.findFirst({
          where: { tenant_id: tenantId },
          select: { current: true },
        }),
      ).toEqual(invoiceSequenceBeforeDisabledCommit);

      const finalized = await request(app.getHttpServer())
        .post(`/api/vehicle-sales/${saleRes.body.id}/finalize`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(finalized.body.invoice.tax_mode).toBe('MARGIN_SCHEME');
      expect(Number(finalized.body.invoice.total_tax)).toBe(333.33);
      expect(Number(finalized.body.invoice.total_gross)).toBe(12000);
      for (const privateField of [
        'snapshot',
        'pdf_archive_bucket',
        'pdf_archive_key',
        'pdf_archive_generation',
        'pdf_archive_sha256',
        'pdf_storage_bucket',
        'pdf_storage_key',
      ]) {
        expect(finalized.body.invoice).not.toHaveProperty(privateField);
      }
      const committedInvoice = await prisma.invoice.findFirstOrThrow({
        where: { id: finalized.body.invoice.id },
        select: {
          snapshot: true,
          tax_mode: true,
          total_net: true,
          total_tax: true,
          total_gross: true,
          items: {
            select: {
              description: true,
              quantity: true,
              unit_price: true,
              tax_rate: true,
              line_total: true,
              revenue_group_name: true,
            },
          },
        },
      });
      expect(
        JSON.stringify({
          tax_mode: committedInvoice.tax_mode,
          total_net: committedInvoice.total_net.toFixed(2),
          total_tax: committedInvoice.total_tax.toFixed(2),
          total_gross: committedInvoice.total_gross.toFixed(2),
          items: committedInvoice.items.map((item) => ({
            description: item.description,
            quantity: item.quantity.toString(),
            unit_price: item.unit_price.toFixed(2),
            tax_rate: item.tax_rate.toFixed(2),
            line_total: item.line_total?.toFixed(2),
            revenue_group_name: item.revenue_group_name,
          })),
        }),
      ).toBe(
        JSON.stringify({
          tax_mode: 'MARGIN_SCHEME',
          total_net: '11666.67',
          total_tax: '333.33',
          total_gross: '12000.00',
          items: [
            {
              description: `2018 Volkswagen Golf VIN ${vin(
                hasConfirmedProfile ? 'SALE02' : 'SALE01',
              )}`,
              quantity: '1',
              unit_price: '12000.00',
              tax_rate: '20.00',
              line_total: '12000.00',
              revenue_group_name: 'Vehicle used (margin)',
            },
          ],
        }),
      );
      const snapshot = committedInvoice.snapshot as {
        schema_version: number;
        snapshot_created_at: string;
        template_version: string;
        margin?: unknown;
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
      expect(snapshot.margin).toBeTruthy();
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
        invoiceId: finalized.body.invoice.id,
        legalEntityId,
        logoAssetId: logo?.id ?? null,
      });

      const publicSale = await request(app.getHttpServer())
        .get(`/api/vehicle-sales/${saleRes.body.id}`)
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
        expect(publicSale.body.invoice).not.toHaveProperty(privateField);
      }

      const committedSiteId = (
        await prisma.invoice.findFirstOrThrow({
          where: { id: finalized.body.invoice.id },
          select: { site_id: true },
        })
      ).site_id;
      if (committedSiteId === null) throw new Error('committed invoice has no site');
      const inaccessibleSite = await createAdditionalLotSite({
        code: `PDF-HIDDEN-${Date.now()}`,
        grantMembership: true,
      });
      await prisma.siteMembership.updateMany({
        where: { site_id: committedSiteId },
        data: { is_active: false },
      });
      const user = await basePrisma.user.findFirstOrThrow({
        where: { firebaseUid: `e2e-user-${tenantId}` },
      });
      await basePrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: inaccessibleSite.site.id },
      });
      const readCountBeforeDeniedRequest = archiveReadKeys.length;
      await request(app.getHttpServer())
        .get(`/api/invoices/${finalized.body.invoice.id}/pdf`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
      expect(archiveReadKeys).toHaveLength(readCountBeforeDeniedRequest);
      await prisma.siteMembership.updateMany({
        where: { site_id: committedSiteId },
        data: { is_active: true },
      });
      await basePrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: committedSiteId },
      });

      const vehicle = await prisma.vehicle.findFirst({
        where: { id: vehicleId },
      });
      expect(vehicle?.inventory_role).toBe('CUSTOMER');
      expect(vehicle?.customer_id).toBe(buyerId);
      expect(vehicle?.stock_status).toBeNull();

      const saleLedger = await prisma.vehicleLedgerEntry.findFirst({
        where: { vehicle_id: vehicleId, entry_type: 'SALE' },
      });
      expect(Number(saleLedger?.amount)).toBe(-12000);
    },
  );
});
