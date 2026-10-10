import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PdfStorage } from '../common/pdf/pdf-storage.js';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { McpDocumentReadService } from './mcp-document-read.service.js';
import { encodeMcpKeysetCursor } from './mcp-output.util.js';

const TENANT_ID = 'tenant-a';
const SITE_ID = 'site-a';
const NOW = new Date('2026-10-10T10:00:00.000Z');
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const INVOICE_ID = '00000000-0000-4000-8000-0000000000a1';
const CREDIT_NOTE_ID = '00000000-0000-4000-8000-0000000000a2';
const ORDER_ID = '00000000-0000-4000-8000-0000000000a3';
const SALE_ID = '00000000-0000-4000-8000-0000000000a4';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const VEHICLE_ID = '00000000-0000-4000-8000-0000000000d1';

type SourceModel = { findMany: jest.Mock; findFirst: jest.Mock };

function sourceModel(): SourceModel {
  return {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  };
}

/** Where clause of the first call, with the AND list flattened for easy assertions. */
function whereOf(model: SourceModel, call = 0): Record<string, unknown> {
  return model.findMany.mock.calls[call][0].where as Record<string, unknown>;
}

describe('McpDocumentReadService', () => {
  let service: McpDocumentReadService;
  let invoice: SourceModel;
  let creditNote: SourceModel;
  let workshopOrder: SourceModel;
  let vehicleSale: SourceModel;
  let pdfStorage: { createSignedReadUrl: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    invoice = sourceModel();
    creditNote = sourceModel();
    workshopOrder = sourceModel();
    vehicleSale = sourceModel();
    pdfStorage = {
      createSignedReadUrl: jest.fn(
        async ({ ttlSeconds }: { ttlSeconds?: number }) => ({
          url: 'https://storage.example.test/signed-link',
          expiresAt: new Date(NOW.getTime() + (ttlSeconds ?? 900) * 1000),
        }),
      ),
    };
    service = new McpDocumentReadService(
      {
        invoice,
        creditNote,
        workshopOrder,
        vehicleSale,
      } as unknown as PrismaService,
      {
        getSiteId: jest.fn().mockResolvedValue(SITE_ID),
      } as unknown as SiteContextService,
      {
        getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
      } as unknown as TenantContextService,
      pdfStorage as unknown as PdfStorage,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('listDocuments', () => {
    it('scopes every source query to the session tenant and the active site', async () => {
      await service.listDocuments({});

      for (const model of [invoice, creditNote, workshopOrder, vehicleSale]) {
        expect(whereOf(model)).toEqual(
          expect.objectContaining({ tenant_id: TENANT_ID, site_id: SITE_ID }),
        );
      }
    });

    it('caps the page at 25 rows and asks each source for one extra row', async () => {
      invoice.findMany.mockResolvedValue(
        Array.from({ length: 26 }, (_, index) => ({
          id: `00000000-0000-4000-8000-${(0x100 + index).toString(16).padStart(12, '0')}`,
          invoice_number: `RE-2026-${1000 + index}`,
          pdf_generated_at: new Date(NOW.getTime() - index * 60_000),
        })),
      );

      const page = await service.listDocuments({ pageSize: 40 });

      expect(invoice.findMany.mock.calls[0][0].take).toBe(26);
      expect(page.data).toHaveLength(25);
      expect(page.meta).toEqual({
        page_size: 25,
        next_cursor: expect.any(String),
      });
      expect(page.truncated).toBe(false);
    });

    it('merges the sources newest first and keeps the cursor on the last row of the page', async () => {
      invoice.findMany.mockResolvedValue([
        {
          id: INVOICE_ID,
          invoice_number: 'RE-2026-1001',
          pdf_generated_at: new Date('2026-10-10T09:00:00.000Z'),
        },
      ]);
      creditNote.findMany.mockResolvedValue([
        {
          id: CREDIT_NOTE_ID,
          credit_number: 'GS-2026-0001',
          pdf_generated_at: new Date('2026-10-10T09:30:00.000Z'),
        },
      ]);
      workshopOrder.findMany.mockResolvedValue([
        {
          id: ORDER_ID,
          order_number: 'WO-2026-0007',
          pdf_generated_at: new Date('2026-10-10T08:00:00.000Z'),
        },
      ]);

      const page = await service.listDocuments({ pageSize: 2 });

      expect(page.data.map((row) => row.id)).toEqual([
        `credit_note:${CREDIT_NOTE_ID}`,
        `invoice:${INVOICE_ID}`,
      ]);
      expect(page.data[0]).toEqual({
        id: `credit_note:${CREDIT_NOTE_ID}`,
        type: 'credit_note',
        name: 'credit-note-GS-2026-0001.pdf',
        created_at: '2026-10-10T09:30:00.000Z',
        entity: { type: 'credit_note', id: CREDIT_NOTE_ID },
      });
      expect(page.meta.next_cursor).not.toBeNull();
    });

    it('resumes strictly after the cursor position in every source', async () => {
      const cursor = encodeMcpKeysetCursor({
        at: '2026-10-10T09:00:00.000Z',
        id: INVOICE_ID,
      });

      await service.listDocuments({ cursor });

      expect(whereOf(invoice).AND).toEqual(
        expect.arrayContaining([
          {
            OR: [
              {
                pdf_generated_at: { lt: new Date('2026-10-10T09:00:00.000Z') },
              },
              {
                pdf_generated_at: new Date('2026-10-10T09:00:00.000Z'),
                id: { lt: INVOICE_ID },
              },
            ],
          },
        ]),
      );
    });

    it('lists only the requested document type', async () => {
      await service.listDocuments({ type: 'credit_note' });

      expect(invoice.findMany).not.toHaveBeenCalled();
      expect(creditNote.findMany).toHaveBeenCalledTimes(1);
      expect(workshopOrder.findMany).not.toHaveBeenCalled();
      expect(vehicleSale.findMany).not.toHaveBeenCalled();
    });

    it('lists a customer across the records that carry the customer', async () => {
      await service.listDocuments({
        entity_type: 'customer',
        entity_id: CUSTOMER_ID,
      });

      expect(whereOf(invoice).AND).toEqual(
        expect.arrayContaining([{ customer_id: CUSTOMER_ID }]),
      );
      expect(whereOf(creditNote).AND).toEqual(
        expect.arrayContaining([
          { original_invoice: { customer_id: CUSTOMER_ID } },
        ]),
      );
      expect(whereOf(workshopOrder).AND).toEqual(
        expect.arrayContaining([{ customer_id: CUSTOMER_ID }]),
      );
      expect(whereOf(vehicleSale).AND).toEqual(
        expect.arrayContaining([{ customer_id: CUSTOMER_ID }]),
      );
    });

    it('lists a vehicle through the invoice and credit note links and the vehicle columns', async () => {
      await service.listDocuments({
        entity_type: 'vehicle',
        entity_id: VEHICLE_ID,
      });

      expect(whereOf(invoice).AND).toEqual(
        expect.arrayContaining([{ vehicle_id: VEHICLE_ID }]),
      );
      expect(whereOf(creditNote).AND).toEqual(
        expect.arrayContaining([
          { original_invoice: { vehicle_id: VEHICLE_ID } },
        ]),
      );
    });

    it('lists one owner record only, without the other sources', async () => {
      await service.listDocuments({
        entity_type: 'invoice',
        entity_id: INVOICE_ID,
      });

      expect(whereOf(invoice).AND).toEqual(
        expect.arrayContaining([{ id: INVOICE_ID }]),
      );
      expect(creditNote.findMany).not.toHaveBeenCalled();
      expect(workshopOrder.findMany).not.toHaveBeenCalled();
      expect(vehicleSale.findMany).not.toHaveBeenCalled();
    });

    it('rejects a cursor that is not a keyset cursor', async () => {
      await expect(
        service.listDocuments({ cursor: 'not-a-cursor' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getDocumentPdf', () => {
    const invoiceRow = {
      id: INVOICE_ID,
      invoice_number: 'RE-2026-1001',
      pdf_generated_at: new Date('2026-10-10T09:00:00.000Z'),
      pdf_archive_bucket: 'archive-bucket',
      pdf_archive_key: 'invoices/archive/RE-2026-1001.pdf',
      pdf_storage_bucket: 'render-bucket',
      pdf_storage_key: 'invoices/render/RE-2026-1001.pdf',
    };

    it('returns metadata and a read link, and never PDF bytes', async () => {
      invoice.findFirst.mockResolvedValue(invoiceRow);

      const result = await service.getDocumentPdf({
        id: `invoice:${INVOICE_ID}`,
      });

      expect(Object.keys(result).sort()).toEqual(
        [
          'content_type',
          'created_at',
          'entity',
          'id',
          'link',
          'name',
          'type',
        ].sort(),
      );
      expect(Object.keys(result.link).sort()).toEqual(['expires_at', 'url']);
      expect(result.content_type).toBe('application/pdf');
      expect(JSON.stringify(result)).not.toMatch(/%PDF|base64|"body"|"stream"/);
    });

    it('issues a link that expires within 15 minutes', async () => {
      invoice.findFirst.mockResolvedValue(invoiceRow);

      const result = await service.getDocumentPdf({
        id: `invoice:${INVOICE_ID}`,
      });

      expect(pdfStorage.createSignedReadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ ttlSeconds: 900 }),
      );
      const expiresInMs = Date.parse(result.link.expires_at) - NOW.getTime();
      expect(expiresInMs).toBeGreaterThan(0);
      expect(expiresInMs).toBeLessThanOrEqual(FIFTEEN_MINUTES_MS);
    });

    it('signs the immutable archive for an invoice, preferring it over the cached render', async () => {
      invoice.findFirst.mockResolvedValue(invoiceRow);

      await service.getDocumentPdf({ id: `invoice:${INVOICE_ID}` });

      expect(pdfStorage.createSignedReadUrl).toHaveBeenCalledWith({
        bucket: 'archive-bucket',
        key: 'invoices/archive/RE-2026-1001.pdf',
        filename: 'invoice-RE-2026-1001.pdf',
        ttlSeconds: 900,
      });
    });

    it('falls back to the cached render when an invoice has no archive', async () => {
      invoice.findFirst.mockResolvedValue({
        ...invoiceRow,
        pdf_archive_key: null,
        pdf_archive_bucket: null,
      });

      await service.getDocumentPdf({ id: `invoice:${INVOICE_ID}` });

      expect(pdfStorage.createSignedReadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'render-bucket',
          key: 'invoices/render/RE-2026-1001.pdf',
        }),
      );
    });

    it('scopes the lookup to the session tenant and the active site', async () => {
      invoice.findFirst.mockResolvedValue(invoiceRow);

      await service.getDocumentPdf({ id: `invoice:${INVOICE_ID}` });

      expect(invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: INVOICE_ID, tenant_id: TENANT_ID, site_id: SITE_ID },
        }),
      );
    });

    it('reports a document of another tenant as not found and signs nothing', async () => {
      invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.getDocumentPdf({ id: `invoice:${INVOICE_ID}` }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(pdfStorage.createSignedReadUrl).not.toHaveBeenCalled();
    });

    it('reports a document without a stored PDF as not generated', async () => {
      invoice.findFirst.mockResolvedValue({
        ...invoiceRow,
        pdf_archive_key: null,
        pdf_storage_key: null,
      });

      await expect(
        service.getDocumentPdf({ id: `invoice:${INVOICE_ID}` }),
      ).rejects.toThrow('is not generated yet');
      expect(pdfStorage.createSignedReadUrl).not.toHaveBeenCalled();
    });

    it('signs the Kaufvertrag archive for a vehicle sale contract with a safe file name', async () => {
      vehicleSale.findFirst.mockResolvedValue({
        id: SALE_ID,
        sale_number: 'KV 2026/0001',
        kaufvertrag_generated_at: new Date('2026-10-10T09:00:00.000Z'),
        kaufvertrag_archive_bucket: 'archive-bucket',
        kaufvertrag_archive_key: 'vehicle-sale-kaufvertrag-archives/x.pdf',
      });

      const result = await service.getDocumentPdf({
        id: `vehicle_sale_contract:${SALE_ID}`,
      });

      expect(pdfStorage.createSignedReadUrl).toHaveBeenCalledWith({
        bucket: 'archive-bucket',
        key: 'vehicle-sale-kaufvertrag-archives/x.pdf',
        filename: 'kaufvertrag-KV_2026_0001.pdf',
        ttlSeconds: 900,
      });
      expect(result.entity).toEqual({ type: 'vehicle_sale', id: SALE_ID });
    });

    it('rejects an ID that is not in the <type>:<uuid> form', async () => {
      await expect(
        service.getDocumentPdf({ id: 'invoice:123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(invoice.findFirst).not.toHaveBeenCalled();
    });

    it('propagates a signing failure without returning a partial result', async () => {
      invoice.findFirst.mockResolvedValue(invoiceRow);
      pdfStorage.createSignedReadUrl.mockRejectedValueOnce(
        new Error('Failed to create PDF download link'),
      );

      await expect(
        service.getDocumentPdf({ id: `invoice:${INVOICE_ID}` }),
      ).rejects.toThrow('Failed to create PDF download link');
    });
  });
});
