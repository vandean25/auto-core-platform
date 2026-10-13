import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resolveTestMainSiteId } from './tenant-test-utils.js';
import { seedLegacyInvoicePdf } from './invoice-branding-archive-test-utils.js';
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

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      authToken,
      legalEntityId,
      customerId,
    } = await createSalesInvoiceSuite());
  });

  afterAll(async () => {
    await disposeSalesInvoiceSuite({ app, basePrisma, prisma, tenantId });
  });

  it('legacy V1 and V2 invoice downloads preserve their existing storage path', async () => {
    const siteId = await resolveTestMainSiteId(prisma, tenantId);
    const snapshotCreatedAt = '2025-01-01T12:00:00.000Z';
    const baseSnapshot = {
      date: '2025-01-01',
      due_date: '2025-01-15',
      notes: null,
      tax_mode: 'STANDARD',
      total_net: '100.00',
      total_tax: '20.00',
      total_gross: '120.00',
      customer: {
        id: customerId,
        type: 'PRIVATE',
        company_name: null,
        first_name: 'Legacy',
        last_name: 'Customer',
        email: null,
        phone: null,
        vat_id: null,
        address_street: null,
        address_city: null,
        address_zip: null,
        address_country: null,
      },
      vehicle: null,
      items: [
        {
          description: 'Legacy item',
          quantity: '1.00',
          unit_price: '100.00',
          tax_rate: '20.00',
          line_discount_type: null,
          line_discount_value: null,
          line_total: '120.00',
          revenue_group_name: null,
        },
      ],
      snapshot_created_at: snapshotCreatedAt,
    };
    const legacyCases = [
      {
        name: 'V1',
        snapshot: {
          id: 'legacy-v1',
          invoice_number: 'LEGACY-V1',
          ...baseSnapshot,
        },
      },
      {
        name: 'V2',
        snapshot: {
          schema_version: 2,
          document_kind: 'INVOICE',
          template_version: 'invoice-pdf-v1',
          site_id: siteId,
          legal_entity_id: legalEntityId,
          currency: 'EUR',
          seller: { name: 'Legacy Seller' },
          tax_breakdown: [],
          ...baseSnapshot,
        },
      },
    ] as const;

    for (const [index, legacyCase] of legacyCases.entries()) {
      const pdfBytes = Buffer.from(`legacy ${legacyCase.name} PDF`);
      const invoice = await prisma.invoice.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          legal_entity_id: legalEntityId,
          customer_id: customerId,
          status: 'ISSUED',
          invoice_number: `LEGACY-${legacyCase.name}-${index}`,
          date: new Date('2025-01-01T12:00:00.000Z'),
          due_date: new Date('2025-01-15T12:00:00.000Z'),
          total_net: 100,
          total_tax: 20,
          total_gross: 120,
          snapshot: legacyCase.snapshot,
          pdf_storage_bucket: 'legacy-invoice-bucket',
          pdf_storage_key: `invoices/legacy-${legacyCase.name}-${index}.pdf`,
          pdf_generated_at: new Date('2025-01-01T12:00:00.000Z'),
        },
        select: { id: true, pdf_storage_key: true },
      });
      seedLegacyInvoicePdf(
        app,
        'legacy-invoice-bucket',
        invoice.pdf_storage_key!,
        pdfBytes,
      );

      const response = await request(app.getHttpServer())
        .get(`/api/invoices/${invoice.id}/pdf`)
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse((incoming, callback) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.body).toEqual(pdfBytes);
    }
  });
});
