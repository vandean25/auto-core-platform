import { createHash } from 'node:crypto';
import {
  buildDocumentSortExcerpt,
  documentSortExcerptAudit,
  DOCUMENT_SORT_EXCERPT_MAX_CHARS,
  redactDocumentSortText,
} from './document-sort-excerpt.js';

describe('document sort excerpt', () => {
  it('replaces emails, phone numbers, IBANs, VINs and long digit runs', () => {
    const excerpt = buildDocumentSortExcerpt(
      'Kontakt: max.muster@example.org, Tel +43 660 1234567, Mobil 0664/1234567. IBAN AT61 1904 3002 3457 3201 bzw. DE89370400440532013000. FIN WBA3A5C50CF256985. Rechnungsnummer 20260011223',
    );

    expect(excerpt.text).toBe(
      'Kontakt: [EMAIL], Tel [PHONE], Mobil [PHONE]. IBAN [IBAN] bzw. [IBAN]. FIN [VIN]. Rechnungsnummer [NUMBER]',
    );
  });

  it('keeps short numbers and amounts', () => {
    const text = 'Angebot Pos 2 Menge 10 Stück, Summe 1.234,56 EUR';

    expect(redactDocumentSortText(text)).toBe(text);
  });

  it('redacts the digits of identifiers that follow letters', () => {
    expect(redactDocumentSortText('RE2026000123 ATU12345678 DE123456789')).toBe(
      'RE[NUMBER] ATU[NUMBER] DE[NUMBER]',
    );
  });

  it('redacts phone numbers written with dots, slashes, brackets and dashes', () => {
    expect(
      redactDocumentSortText(
        '0664.123.45.67 | 0664 / 1234567 | +43 (0) 660 1234567 | +43–660–1234567',
      ),
    ).toBe('[PHONE] | [PHONE] | [PHONE] | [PHONE]');
  });

  it('keeps a stray bracket when the cap does not cut the text', () => {
    const text = 'Rechnung Entwurf [ Anmerkung: bitte prüfen';

    expect(buildDocumentSortExcerpt(text).text).toBe(text);
  });

  it('keeps a stray bracket in a long text unless the cap cuts a placeholder', () => {
    const excerpt = buildDocumentSortExcerpt(`Entwurf [ ${'x'.repeat(2000)}`);

    expect(excerpt.text).toHaveLength(DOCUMENT_SORT_EXCERPT_MAX_CHARS);
    expect(excerpt.text.startsWith('Entwurf [ xxx')).toBe(true);
  });

  it('caps the excerpt at the excerpt limit', () => {
    const excerpt = buildDocumentSortExcerpt('Lieferschein '.repeat(500));

    expect(excerpt.text).toHaveLength(DOCUMENT_SORT_EXCERPT_MAX_CHARS);
    expect(excerpt.length).toBe(DOCUMENT_SORT_EXCERPT_MAX_CHARS);
  });

  it('never leaves a placeholder cut in half at the cap', () => {
    // The email starts at index 1498 and becomes "[EMAIL]", which the cap cuts after "[EM".
    const excerpt = buildDocumentSortExcerpt(
      `${'x'.repeat(1497)} max@example.org`,
    );

    expect(excerpt.text).toBe('x'.repeat(1497));
    expect(excerpt.text).not.toMatch(/\[|max@|example/);
  });

  it('reports the length and SHA-256 of the excerpt that is sent', () => {
    const excerpt = buildDocumentSortExcerpt('Hallo Werkstatt, Tel +43 660 1234567');

    expect(excerpt.length).toBe(excerpt.text.length);
    expect(excerpt.sha256).toBe(
      createHash('sha256').update(excerpt.text).digest('hex'),
    );
  });

  it('audits only the length and hash, never the text', () => {
    const excerpt = buildDocumentSortExcerpt('Hallo Werkstatt, Tel +43 660 1234567');
    const audit = documentSortExcerptAudit(excerpt);

    expect(audit).toEqual({
      text_excerpt_length: excerpt.length,
      text_excerpt_sha256: excerpt.sha256,
    });
    expect(JSON.stringify(audit)).not.toContain('Werkstatt');
  });

  it('stays within the cap for very long text', () => {
    const excerpt = buildDocumentSortExcerpt('Angebot '.repeat(100_000));

    expect(excerpt.text.length).toBeLessThanOrEqual(
      DOCUMENT_SORT_EXCERPT_MAX_CHARS,
    );
  });
});
