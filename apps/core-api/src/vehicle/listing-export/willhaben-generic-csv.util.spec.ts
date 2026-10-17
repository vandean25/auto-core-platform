import {
  decodeWillhabenCsv,
  encodeWillhabenCsv,
  joinWillhabenRow,
  quoteWillhabenField,
} from './willhaben-generic-csv.util.js';

describe('willhaben-generic CSV utilities', () => {
  it('quotes every field and doubles embedded quotes', () => {
    expect(quoteWillhabenField('plain')).toBe('"plain"');
    expect(quoteWillhabenField('17" Felgen')).toBe('"17"" Felgen"');
  });

  it('joins fields with the generic delimiter while keeping in-field delimiters', () => {
    const row = joinWillhabenRow(['a', 'b;c', 'd"e']);
    expect(row).toBe('"a";"b;c";"d""e"');
    expect(row).toContain(`"b;c"`);
  });

  it('round-trips UTF-8 content including umlauts and line breaks', () => {
    const content = '"Weiß metallic";"Zeile 1\nZeile 2"\n';
    expect(decodeWillhabenCsv(encodeWillhabenCsv(content))).toBe(content);
  });
});
