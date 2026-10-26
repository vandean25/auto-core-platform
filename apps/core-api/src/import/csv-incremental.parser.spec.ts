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
});
