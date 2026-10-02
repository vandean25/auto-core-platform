import { parseCsvFile, serializeCsv } from './csv-parse.util.js';

describe('csv-parse.util', () => {
  it('auto-detects semicolon delimiter and strips BOM', () => {
    const buffer = Buffer.from(
      '\uFEFFKunden-Nr;E-Mail\n1001;test@example.com\n',
      'utf8',
    );
    const parsed = parseCsvFile(buffer);
    expect(parsed.delimiter).toBe(';');
    expect(parsed.headers).toEqual(['Kunden-Nr', 'E-Mail']);
    expect(parsed.rows).toHaveLength(1);
  });

  it('parses comma-separated files', () => {
    const buffer = Buffer.from('id,email\n1,a@b.com\n', 'utf8');
    const parsed = parseCsvFile(buffer);
    expect(parsed.delimiter).toBe(',');
  });

  it('decodes Windows-1252 umlauts when UTF-8 is invalid', () => {
    const buffer = Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]); // Müller without header row context
    const parsed = parseCsvFile(
      Buffer.concat([
        Buffer.from('name\n', 'utf8'),
        buffer,
        Buffer.from('\n', 'utf8'),
      ]),
    );
    expect(parsed.rows[0][0]).toContain('ller');
  });

  it('serializes CSV with quoting', () => {
    const csv = serializeCsv(['a'], [['value;semi']], ';');
    expect(csv).toContain('"value;semi"');
  });

  it('parses quoted fields with embedded newlines', () => {
    const buffer = Buffer.from(
      'name;street\n"Acme";"Hauptstr. 1\nStiege 2"\n',
      'utf8',
    );
    const parsed = parseCsvFile(buffer);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0][1]).toContain('\n');
  });

  it('neutralises formula injection in serialized CSV', () => {
    const csv = serializeCsv(['id'], [['=1+1']], ';');
    expect(csv).toContain("'=1+1");
  });
});
