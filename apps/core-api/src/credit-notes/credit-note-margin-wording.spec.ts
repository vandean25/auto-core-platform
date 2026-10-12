import { escapeHtml } from '../common/pdf/pdf-layout.js';
import {
  buildInvoiceTotalsSection,
  MARGIN_SCHEME_LEGAL_NOTES,
} from '../invoices/invoice-pdf.layout.js';
import {
  createFullMarginCreditNote,
  createMarginSchemeSnapshotV2,
} from '../invoices/margin-scheme-snapshot.spec.support.js';
import { toRenderableCreditNoteSnapshot } from './credit-note-snapshot-render.adapter.js';

describe('margin-scheme Stornorechnung wording', () => {
  it.each([
    {
      countryIso: 'AT' as const,
      note: MARGIN_SCHEME_LEGAL_NOTES.AT,
      statute: '§ 24 UStG 1994',
      otherNote: MARGIN_SCHEME_LEGAL_NOTES.DE,
      otherStatute: '§ 25a',
    },
    {
      countryIso: 'DE' as const,
      note: MARGIN_SCHEME_LEGAL_NOTES.DE,
      statute: '§ 25a UStG',
      otherNote: MARGIN_SCHEME_LEGAL_NOTES.AT,
      otherStatute: '§ 24 UStG',
    },
  ])(
    'carries the $countryIso legal note from the original invoice onto the full credit note',
    ({ countryIso, note, statute, otherNote, otherStatute }) => {
      const original = createMarginSchemeSnapshotV2(countryIso);
      const credit = createFullMarginCreditNote(original);

      expect(credit).toMatchObject({
        document_kind: 'CREDIT_NOTE',
        credit_title: 'Stornorechnung',
        tax_mode: 'MARGIN_SCHEME',
        seller: original.seller,
        margin: original.margin,
        total_tax: '0.00',
      });
      expect(credit.tax_breakdown).toEqual([]);

      const renderable = toRenderableCreditNoteSnapshot(
        credit,
        'CN-2026-0007',
        'credit-margin-1',
      );
      expect(renderable).not.toBeNull();

      const html = buildInvoiceTotalsSection(renderable!, escapeHtml);
      expect(html).toContain(note);
      expect(html).toContain(statute);
      expect(html).not.toContain(otherNote);
      expect(html).not.toContain(otherStatute);
      expect(html).not.toContain('Umsatzsteuer');
      expect(html).not.toContain('500.00');
      expect(html).not.toContain('12000.00');
    },
  );
});
