import { Readable } from 'node:stream';
import {
  CsvIncrementalParser,
  readCsvDataRowSliceFromStream,
} from './csv-incremental.parser.js';

describe('CsvIncrementalParser', () => {
  it('reads a middle slice without parsing the whole file into memory', async () => {
    const csv = 'a;b\n1;1\n2;2\n3;3\n4;4\n';
    const stream = Readable.from([Buffer.from(csv.slice(0, 4)), Buffer.from(csv.slice(4))]);
    const slice = await readCsvDataRowSliceFromStream(stream, 1, 2);
    expect(slice?.headers).toEqual(['a', 'b']);
    expect(slice?.rows).toEqual([['2', '2'], ['3', '3']]);
  });

  it('counts rows when fed in chunks', () => {
    const parser = new CsvIncrementalParser();
    const header = parser.feedChunk(Buffer.from('h1;h2\n'));
    expect(header).toEqual([]);
    const rows = parser.feedChunk(Buffer.from('1;2\n3;4\n'));
    expect(rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('returns exactly batchSize rows when the file has batchSize data rows', async () => {
    const batchSize = 3;
    const data = Array.from({ length: batchSize }, (_, i) => `${i + 1};x`).join('\n');
    const csv = `a;b\n${data}\n`;
    const stream = Readable.from([Buffer.from(csv)]);
    const slice = await readCsvDataRowSliceFromStream(stream, 0, batchSize);
    expect(slice?.rows).toHaveLength(batchSize);
    expect(slice?.rows.at(-1)).toEqual([String(batchSize), 'x']);
  });

  it('includes the last row when the file has batchSize plus one data rows', async () => {
    const batchSize = 3;
    const data = Array.from({ length: batchSize + 1 }, (_, i) => `${i + 1};x`).join('\n');
    const csv = `a;b\n${data}\n`;
    const stream = Readable.from([Buffer.from(csv)]);
    const slice = await readCsvDataRowSliceFromStream(stream, 0, batchSize);
    expect(slice?.rows).toHaveLength(batchSize);
    const tail = await readCsvDataRowSliceFromStream(
      Readable.from([Buffer.from(csv)]),
      batchSize,
      1,
    );
    expect(tail?.rows).toEqual([[String(batchSize + 1), 'x']]);
  });
});
