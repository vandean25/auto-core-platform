import { Readable } from 'node:stream';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { LocalImportFileStorage } from './import-file.storage.js';
import { readImportCsvDataRowSlice } from './import-csv-stream.util.js';
import { pipeImportCsvToStorage } from './import-upload-pipeline.js';

function csvWithDataRows(count: number): string {
  const rows = Array.from({ length: count }, (_, index) => `${index + 1};x`);
  return `a;b\n${rows.join('\n')}\n`;
}

describe('pipeImportCsvToStorage', () => {
  const storage = new LocalImportFileStorage();

  async function pipeCsv(text: string) {
    return pipeImportCsvToStorage(storage, {
      tenantId: 'tenant-1',
      jobId: 'job-1',
      fileName: 'data.csv',
      source: Readable.from([Buffer.from(text, 'utf8')]),
    });
  }

  it('counts limit-1, limit, and rejects limit+1 data rows', async () => {
    const limit = 5;
    const previous = process.env.IMPORT_MAX_ROW_COUNT;
    process.env.IMPORT_MAX_ROW_COUNT = String(limit);
    try {
      const under = await pipeCsv(csvWithDataRows(limit - 1));
      expect(under.dataRowCount).toBe(limit - 1);

      const exact = await pipeCsv(csvWithDataRows(limit));
      expect(exact.dataRowCount).toBe(limit);

      await expect(pipeCsv(csvWithDataRows(limit + 1))).rejects.toMatchObject({
        response: {
          code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
        },
      });
    } finally {
      if (previous === undefined) {
        delete process.env.IMPORT_MAX_ROW_COUNT;
      } else {
        process.env.IMPORT_MAX_ROW_COUNT = previous;
      }
    }
  });

  it('stores every data row for batch size and batch size+1 (background slice parity)', async () => {
    const batchSize = 3;
    const rowCount = batchSize + 1;
    const piped = await pipeCsv(csvWithDataRows(rowCount));
    expect(piped.dataRowCount).toBe(rowCount);

    const firstBatch = await readImportCsvDataRowSlice(
      storage.openReadStream(piped.ref),
      0,
      batchSize,
    );
    expect(firstBatch?.rows).toHaveLength(batchSize);
    expect(firstBatch?.rows.at(-1)).toEqual([String(batchSize), 'x']);

    const secondBatch = await readImportCsvDataRowSlice(
      storage.openReadStream(piped.ref),
      batchSize,
      batchSize,
    );
    expect(secondBatch?.rows).toEqual([[String(rowCount), 'x']]);
  });
});
