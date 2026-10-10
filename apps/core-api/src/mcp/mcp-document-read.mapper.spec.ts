import {
  isMcpDocumentId,
  mcpDocumentFileName,
  parseMcpDocumentId,
  summarizeMcpDocumentPdfForLog,
  toMcpDocumentPdf,
  toMcpDocumentRow,
} from './mcp-document-read.mapper.js';

const RECORD_ID = '00000000-0000-4000-8000-0000000000a1';
const SIGNED_URL =
  'https://storage.example.test/bucket/invoice.pdf?X-Goog-Signature=abc123';

describe('mcp-document-read.mapper', () => {
  describe('document IDs', () => {
    it.each([
      'invoice',
      'credit_note',
      'workshop_order',
      'vehicle_sale_contract',
    ])('accepts %s:<uuid>', (type) => {
      expect(isMcpDocumentId(`${type}:${RECORD_ID}`)).toBe(true);
      expect(parseMcpDocumentId(`${type}:${RECORD_ID}`)).toEqual({
        type,
        recordId: RECORD_ID,
      });
    });

    it('lowercases the UUID part so the lookup matches stored IDs', () => {
      expect(parseMcpDocumentId(`invoice:${RECORD_ID.toUpperCase()}`)).toEqual({
        type: 'invoice',
        recordId: RECORD_ID,
      });
    });

    it.each([
      ['an unknown type', `quote:${RECORD_ID}`],
      ['a missing UUID', 'invoice:'],
      ['a bare UUID', RECORD_ID],
      ['a non-UUID record', 'invoice:123'],
      ['extra text', `invoice:${RECORD_ID}/../secret`],
    ])('rejects %s', (_label, value) => {
      expect(isMcpDocumentId(value)).toBe(false);
      expect(parseMcpDocumentId(value)).toBeNull();
    });
  });

  describe('file names', () => {
    it('matches the names the REST PDF downloads send', () => {
      expect(mcpDocumentFileName('invoice', 'RE-2026-1001', RECORD_ID)).toBe(
        'invoice-RE-2026-1001.pdf',
      );
      expect(
        mcpDocumentFileName('credit_note', 'GS-2026-0001', RECORD_ID),
      ).toBe('credit-note-GS-2026-0001.pdf');
      expect(
        mcpDocumentFileName('workshop_order', 'WO-2026-0007', RECORD_ID),
      ).toBe('job-card-WO-2026-0007.pdf');
    });

    it('turns the sale number of a Kaufvertrag into a plain file name', () => {
      expect(
        mcpDocumentFileName('vehicle_sale_contract', 'KV 2026/0001', RECORD_ID),
      ).toBe('kaufvertrag-KV_2026_0001.pdf');
    });

    it('falls back to the record ID when the document has no number yet', () => {
      expect(mcpDocumentFileName('invoice', null, RECORD_ID)).toBe(
        `invoice-${RECORD_ID}.pdf`,
      );
    });
  });

  describe('rows and links', () => {
    const candidate = {
      type: 'invoice' as const,
      recordId: RECORD_ID,
      createdAt: new Date('2026-10-10T09:00:00.000Z'),
      name: 'invoice-RE-2026-1001.pdf',
    };

    it('maps a row to the documented shape, with the owner record as the entity', () => {
      expect(toMcpDocumentRow(candidate)).toEqual({
        id: `invoice:${RECORD_ID}`,
        type: 'invoice',
        name: 'invoice-RE-2026-1001.pdf',
        created_at: '2026-10-10T09:00:00.000Z',
        entity: { type: 'invoice', id: RECORD_ID },
      });
    });

    it('adds the content type and the link without any PDF bytes', () => {
      const pdf = toMcpDocumentPdf(candidate, {
        url: SIGNED_URL,
        expiresAt: new Date('2026-10-10T09:15:00.000Z'),
      });

      expect(pdf.content_type).toBe('application/pdf');
      expect(pdf.link).toEqual({
        url: SIGNED_URL,
        expires_at: '2026-10-10T09:15:00.000Z',
      });
    });

    it('logs the document and the expiry, never the link itself', () => {
      const pdf = toMcpDocumentPdf(candidate, {
        url: SIGNED_URL,
        expiresAt: new Date('2026-10-10T09:15:00.000Z'),
      });

      const summary = summarizeMcpDocumentPdfForLog(pdf);

      expect(summary).toEqual({
        document_id: `invoice:${RECORD_ID}`,
        document_type: 'invoice',
        entity: { type: 'invoice', id: RECORD_ID },
        link_expires_at: '2026-10-10T09:15:00.000Z',
      });
      expect(JSON.stringify(summary)).not.toContain('X-Goog-Signature');
      expect(JSON.stringify(summary)).not.toContain(SIGNED_URL);
    });

    it('logs nothing for a result without a link, such as a failure', () => {
      expect(summarizeMcpDocumentPdfForLog(undefined)).toBeNull();
      expect(summarizeMcpDocumentPdfForLog({ error: 'boom' })).toBeNull();
    });
  });
});
