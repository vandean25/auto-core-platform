import { jest } from '@jest/globals';
import type { ParsedCsv } from './csv-parse.util.js';
import type { DryRunRowResult } from './import.types.js';
import { ImportRowAction } from '@prisma/client';

jest.unstable_mockModule('./import-dry-run-reconcile.records.js', () => ({
  loadCsvRowRecords: jest.fn(
    async (
      _fileStorage: unknown,
      _upload: unknown,
      _sha: unknown,
      rowNos: number[],
    ) => rowNos.map((rowNo) => ({ rowNo, record: { id: String(rowNo) } })),
  ),
  toParsedCsvFromRecords: (
    headers: string[],
    records: Array<{ rowNo: number; record: Record<string, string> }>,
    sha256: string,
  ): ParsedCsv => ({
    headers,
    rows: records.map((entry) => headers.map((header) => entry.record[header] ?? '')),
    delimiter: ';',
    sha256,
  }),
  recordFromStoredRow: () => ({}),
}));

jest.unstable_mockModule('./import-csv-stream.util.js', () => ({
  readImportCsvDataRowSlice: jest.fn(async () => ({
    headers: ['id'],
    rows: [['1']],
  })),
}));

const { replanImportDryRunUnitChunk } = await import(
  './import-dry-run-reconcile.replan.js'
);

describe('replanImportDryRunUnitChunk plan slice', () => {
  it('calls planDryRun with at most batchSize parsed rows', async () => {
    let maxRows = 0;
    const handler = {
      planDryRun: async (
        _input: unknown,
        parsed: ParsedCsv,
      ): Promise<DryRunRowResult[]> => {
        maxRows = Math.max(maxRows, parsed.rows.length);
        return parsed.rows.map((_, index) => ({
          row_no: index + 1,
          external_id: null,
          action: ImportRowAction.CREATE,
          entity_id: null,
          errors: [],
          warnings: [],
          normalized: {},
        }));
      },
    };
    await replanImportDryRunUnitChunk({
      prisma: {
        importJobRow: {
          findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
        },
      } as never,
      fileStorage: { openReadStream: jest.fn() } as never,
      upload: { object_key: 'imports/test.csv' },
      fileSha256: 'sha',
      tenantId: 'tenant',
      jobId: 'job',
      handler: handler as never,
      input: {
        tenantId: 'tenant',
        sourceSystem: 'legacy',
        mapping: { external_id: 'id' },
        options: {},
      },
      unit: {
        context_from_row: 1,
        context_to_row: 6,
        replan_row_nos: [1, 2, 3, 4, 5, 6],
      },
      targetStartIndex: 0,
      batchSize: 2,
      deadlineMs: Date.now() + 60_000,
    });
    expect(maxRows).toBe(2);
  });
});
