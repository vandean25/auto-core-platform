import { parseCsvFile, rowToRecord, serializeCsv } from './csv-parse.util.js';
import { buildImportErrorReportCsv } from './import-job.serializer.js';

describe('csv-parse.util', () => {
  it('reimports semicolon reports whose original headers contain many commas', () => {
    const headers = ['Source ID', 'Description,a,b,c,d,e,f,g', 'Unused'];
    const csv = buildImportErrorReportCsv(
      [
        {
          row_no: 1,
          errors_json: [{ code: 'IMPORT_APPLY_FAILED' }],
          source_cells: ['A-1', 'Original name', 'extra'],
        },
      ],
      { headers, mapping: { external_id: 'Source ID' }, locale: 'en' },
    );
    const parsed = parseCsvFile(Buffer.from(csv));
    expect(parsed.delimiter).toBe(';');
    expect(rowToRecord(parsed.headers, parsed.rows[0])).toEqual({
      'Source ID': 'A-1',
      'Description,a,b,c,d,e,f,g': 'Original name',
      Unused: 'extra',
    });
  });
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

  it('reimports source columns that collide with report diagnostics', () => {
    const parsed = parseCsvFile(
      Buffer.from(
        'row_no;Source ID;row_no;error_message;error_field;error_message;error_code\r\n7;fixed-id;original-row;Original name;;Reason;CODE\r\n',
      ),
    );
    expect(rowToRecord(parsed.headers, parsed.rows[0])).toEqual({
      'Source ID': 'fixed-id',
      row_no: 'original-row',
      error_message: 'Original name',
    });
  });

  it('restores spreadsheet-safe source values only when reimporting a report', () => {
    const headers = [
      'row_no',
      'Source ID',
      'Phone',
      'Quoted value',
      'error_field',
      'error_message',
      'error_code',
      'note',
    ];
    expect(
      rowToRecord(headers, [
        '2',
        "'+ID",
        "'+123",
        "''original",
        '',
        'Reason',
        'CODE',
        'Saved values',
      ]),
    ).toEqual({
      'Source ID': '+ID',
      Phone: '+123',
      'Quoted value': "'original",
    });
    expect(rowToRecord(['Source ID'], ["'+ID"])).toEqual({
      'Source ID': "'+ID",
    });
  });
});
