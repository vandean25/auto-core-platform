import { Readable } from 'node:stream';
import { assessImportCsvFromReadable } from './import-csv-stream.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';

function csvWithDataRows(count: number): string {
  const rows = Array.from({ length: count }, (_, index) => `id-${index + 1};x`);
  return `external_id;name\n${rows.join('\n')}\n`;
}

describe('assessImportCsvFromReadable row limits', () => {
  it('accepts limit-1, limit, and rejects limit+1 data rows', async () => {
    const limit = 5;
    for (const count of [limit - 1, limit]) {
      const assessed = await assessImportCsvFromReadable(
        Readable.from([Buffer.from(csvWithDataRows(count))]),
        { maxDataRows: limit },
      );
      expect(assessed.dataRowCount).toBe(count);
    }

    await expect(
      assessImportCsvFromReadable(
        Readable.from([Buffer.from(csvWithDataRows(limit + 1))]),
        { maxDataRows: limit },
      ),
    ).rejects.toMatchObject({
      response: { code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED },
    });
  });
});
