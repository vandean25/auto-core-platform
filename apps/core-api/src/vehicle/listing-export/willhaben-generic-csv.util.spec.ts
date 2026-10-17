import {
  decodeWillhabenCsv,
  encodeWillhabenCsv,
  joinWillhabenRow,
  quoteWillhabenField,
  sanitizeWillhabenCsvFieldValue,
} from './willhaben-generic-csv.util.js';

describe('willhaben-generic CSV utilities', () => {
  it('quotes every field and doubles embedded quotes', () => {
    expect(quoteWillhabenField('plain')).toBe('"plain"');
    expect(quoteWillhabenField('17" Felgen')).toBe('"17"" Felgen"');
  });

  it('joins fields with the generic delimiter while keeping in-field delimiters', () => {
    const row = joinWillhabenRow(['a', 'b;c', 'd"e']);
    expect(row).toBe('"a";"b;c";"d""e"');
    expect(row).toContain('"b;c"');
  });

  it('prefixes formula-leading text with an apostrophe', () => {
    expect(sanitizeWillhabenCsvFieldValue('=1+1')).toBe("'=1+1");
    expect(sanitizeWillhabenCsvFieldValue('+49 1')).toBe("'+49 1");
    expect(sanitizeWillhabenCsvFieldValue(' @SUM(A1)')).toBe("' @SUM(A1)");
    expect(sanitizeWillhabenCsvFieldValue('\t=WROOM')).toBe("' =WROOM");
    expect(sanitizeWillhabenCsvFieldValue('=SUM("A1")')).toBe('\'=SUM("A1")');
    expect(
      quoteWillhabenField(sanitizeWillhabenCsvFieldValue('=SUM("A1")')),
    ).toBe('"\'=SUM(""A1"")"');
    expect(sanitizeWillhabenCsvFieldValue('Example Motors')).toBe(
      'Example Motors',
    );
  });

  it('replaces control characters with spaces so records stay one line', () => {
    expect(sanitizeWillhabenCsvFieldValue('a\nb\rc\r\nd')).toBe('a b c  d');
    expect(sanitizeWillhabenCsvFieldValue('Weiß\tmetallic')).toBe(
      'Weiß metallic',
    );
  });

  it('round-trips UTF-8 content including umlauts', () => {
    const content = '"Weiß metallic";"Größe"\r\n';
    expect(decodeWillhabenCsv(encodeWillhabenCsv(content))).toBe(content);
  });
});
