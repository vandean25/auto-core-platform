import { Readable } from 'node:stream';
import { openImportSourceRows } from './import-error-report.source.js';
import { buildImportErrorReportCsv } from './import-job.serializer.js';
import { parseCsvFile, rowToRecord } from './csv-parse.util.js';

describe('stored import source rows', () => {
  it('skips leading blank records before the original header', async () => {
    const source = await openImportSourceRows(
      Readable.from([
        Buffer.from('\r\n\n  \r\nSource ID;Name\r\nA-1;Sample\r\n'),
      ]),
    );
    expect(source.headers).toEqual(['Source ID', 'Name']);
    expect((await source.rows.next()).value).toEqual(['A-1', 'Sample']);
    await source.close();
  });

  it('preserves business fields and protected values across repeated correction reports', async () => {
    const originalHeaders = [
      'ID',
      'row_no',
      'error_message',
      'Phone',
      'Quoted',
    ];
    let headers = originalHeaders;
    let cells = ['+ID', 'source-row', 'Original name', '+123', "'original"];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const csv = buildImportErrorReportCsv(
        [
          {
            row_no: 1,
            errors_json: [
              { code: 'IMPORT_APPLY_FAILED', message: 'Raw exception' },
            ],
            source_cells: cells,
          },
        ],
        {
          headers,
          mapping: {
            external_id: 'ID',
            first_name: 'error_message',
            phone: 'Phone',
          },
          locale: 'en',
        },
      );
      const parsed = parseCsvFile(Buffer.from(csv));
      expect(rowToRecord(parsed.headers, parsed.rows[0])).toEqual({
        ID: '+ID',
        row_no: 'source-row',
        error_message: 'Original name',
        Phone: '+123',
        Quoted: "'original",
      });
      const source = await openImportSourceRows(
        Readable.from([Buffer.from(csv)]),
      );
      expect(source.headers).toEqual(originalHeaders);
      const next = await source.rows.next();
      if (next.done) throw new Error('Missing corrected source row');
      cells = next.value;
      headers = source.headers;
      await source.close();
    }
  });
  it('preserves quoted headers and cells across one-byte UTF-8 chunks', async () => {
    const text =
      '\uFEFFSource ID;"  Original; header\nsecond line  ";Unused\r\nA-1;"  Grüße; ""quoted""\r\nsecond line  ";extra\r\n\r\nA-2;tail;last';
    const chunks = Array.from(Buffer.from(text), (byte) => Buffer.from([byte]));
    const source = await openImportSourceRows(Readable.from(chunks));
    const rows: string[][] = [];
    for await (const row of source.rows) rows.push(row);
    expect(source.headers).toEqual([
      'Source ID',
      '  Original; header\nsecond line  ',
      'Unused',
    ]);
    expect(rows).toEqual([
      ['A-1', '  Grüße; "quoted"\r\nsecond line  ', 'extra'],
      ['A-2', 'tail', 'last'],
    ]);
  });

  it('detects commas without counting semicolons inside quoted header names', async () => {
    const source = await openImportSourceRows(
      Readable.from([
        Buffer.from(
          'Source ID,"Original; ; ; description",Unused\r\nA-1,"keep,me",extra\r\n',
        ),
      ]),
    );
    expect(source.headers).toEqual([
      'Source ID',
      'Original; ; ; description',
      'Unused',
    ]);
    expect((await source.rows.next()).value).toEqual([
      'A-1',
      'keep,me',
      'extra',
    ]);
    await source.close();
  });

  it('reads Windows-1252 source values', async () => {
    const stream = Readable.from([
      Buffer.concat([
        Buffer.from('Name\r\nGr'),
        Buffer.from([0xfc, 0xdf]),
        Buffer.from('e\r\n'),
      ]),
    ]);
    const source = await openImportSourceRows(stream);
    expect((await source.rows.next()).value).toEqual(['Grüße']);
    await source.close();
    expect(stream.destroyed).toBe(true);
  });
});
