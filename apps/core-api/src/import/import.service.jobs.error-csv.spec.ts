import { Readable } from 'node:stream';
import { ImportEntityType, ImportJobStatus, ImportRowAction } from '@prisma/client';
import { parseCsvFile } from './csv-parse.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import {
  JOB_ID,
  TENANT_ID,
  dryRunParams,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} from './import.service.spec.support.js';

async function consumeCsv(report: string | Readable): Promise<string> {
  if (typeof report === 'string') return report;
  const chunks: Buffer[] = [];
  for await (const chunk of report) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const mapping = {
  external_id: 'Source ID',
  first_name: 'Given name',
  last_name: 'Family name',
};
const source =
  'Source ID;Given name;Family name;Unused\r\nA-1;First;Sample;ok\r\n;Second;Sample;"keep;me"\r\nA-3;Third;Sample;ok\r\n';
const errorRow = jobRowRecord({
  row_no: 2,
  action: ImportRowAction.ERROR,
  normalized_json: { first_name: 'Second', last_name: 'Sample' },
  errors_json: [
    {
      code: IMPORT_ERROR_CODES.APPLY_FAILED,
      message: 'raw sensitive exception',
    },
  ],
});

// Import row numbers count data records, excluding the header.
describe('ImportService streamed error CSV', () => {
  const h = setupImportHarness();

  function arrangeSource() {
    h.prisma.importJob.findFirst.mockResolvedValue(
      importJobRecord({
        mapping_json: mapping,
        options_json: {
          upload: {
            object_key: 'tenant-1/job-1/source.csv',
            headers: ['Source ID', 'Given name', 'Family name', 'Unused'],
          },
        },
      }),
    );
    h.fileStorage.openReadStream.mockImplementation(() =>
      Readable.from([Buffer.from(source)]),
    );
    h.prisma.importJobRow.findMany
      .mockResolvedValueOnce([errorRow])
      .mockResolvedValue([]);
  }

  it('streams error rows for a FAILED job whose non-error rows were purged', async () => {
    h.prisma.importJob.findFirst.mockResolvedValue(
      importJobRecord({
        status: ImportJobStatus.FAILED,
        mapping_json: mapping,
        options_json: {
          upload: {
            object_key: 'tenant-1/job-1/source.csv',
            headers: ['Source ID', 'Given name', 'Family name', 'Unused'],
          },
        },
      }),
    );
    h.fileStorage.openReadStream.mockImplementation(() =>
      Readable.from([Buffer.from(source)]),
    );
    h.prisma.importJobRow.findMany
      .mockResolvedValueOnce([errorRow])
      .mockResolvedValue([]);

    const report = await h.service.downloadErrorRowsCsv(JOB_ID);
    const csv = await consumeCsv(report);
    const parsed = parseCsvFile(Buffer.from(csv));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0][0]).toBe('2');
  });

  it('streams original values including unmapped columns rather than normalized payloads', async () => {
    arrangeSource();
    const report = await h.service.downloadErrorRowsCsv(JOB_ID);
    expect(typeof report).not.toBe('string');
    const csv = await consumeCsv(report);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const parsed = parseCsvFile(Buffer.from(csv));
    expect(parsed.headers).toEqual([
      'row_no',
      'Source ID',
      'Given name',
      'Family name',
      'Unused',
      'error_field',
      'error_message',
      'error_code',
    ]);
    expect(parsed.rows[0].slice(0, 5)).toEqual([
      '2',
      '',
      'Second',
      'Sample',
      'keep;me',
    ]);
    expect(csv).not.toContain('raw sensitive exception');
    expect(h.fileStorage.readBytes).not.toHaveBeenCalled();
  });

  it('reads 50,000 error rows in bounded keyset pages', async () => {
    arrangeSource();
    let sourceRowsRead = 0;
    h.fileStorage.openReadStream.mockImplementation(() =>
      Readable.from(
        (function* () {
          yield Buffer.from('Source ID;Given name;Family name;Unused\r\n');
          for (let index = 1; index <= 50_000; index += 1) {
            sourceRowsRead += 1;
            yield Buffer.from(
              `SOURCE-${index};Sample;Row;Original-${index}\r\n`,
            );
          }
        })(),
      ),
    );
    let reads = 0;
    h.prisma.importJobRow.findMany
      .mockReset()
      .mockImplementation(
        ({
          where,
          take,
        }: {
          where: { row_no?: { gt: number } };
          take?: number;
        }) => {
          if (!take || take > 1000 || !where.row_no)
            throw new Error('Unbounded error row query');
          reads += 1;
          const after = where.row_no.gt;
          return Promise.resolve(
            Array.from(
              { length: Math.min(take, 50_000 - after) },
              (_, index) => ({ ...errorRow, row_no: after + index + 1 }),
            ),
          );
        },
      );
    const report = await h.service.downloadErrorRowsCsv(JOB_ID);
    expect(typeof report).not.toBe('string');
    expect(sourceRowsRead).toBeLessThan(100);
    expect(reads).toBe(0);
    let lines = 0;
    for await (const chunk of report)
      lines += String(chunk).split('\r\n').length - 1;
    expect(lines).toBe(50_001);
    expect(reads).toBeGreaterThan(50);
    expect(sourceRowsRead).toBe(50_000);
    expect(h.fileStorage.openReadStream).toHaveBeenCalledTimes(1);
  });

  it('falls back to mapped normalized values only when storage reports a missing upload', async () => {
    arrangeSource();
    h.fileStorage.openReadStream.mockImplementation(
      () =>
        new Readable({
          read() {
            this.destroy(Object.assign(new Error('missing'), { code: 404 }));
          },
        }),
    );
    const csv = await consumeCsv(await h.service.downloadErrorRowsCsv(JOB_ID));
    const parsed = parseCsvFile(Buffer.from(csv));
    expect(parsed.headers.at(-1)).toBe('note');
    expect(parsed.rows[0].slice(0, 5)).toEqual([
      '2',
      '',
      'Second',
      'Sample',
      '',
    ]);
    expect(csv).toContain('Die Originaldatei ist nicht mehr verfügbar.');
  });

  it('does not hide storage authorization or network failures as retention', async () => {
    arrangeSource();
    h.fileStorage.openReadStream.mockImplementation(
      () =>
        new Readable({
          read() {
            this.destroy(
              Object.assign(new Error('access denied'), { code: 403 }),
            );
          },
        }),
    );
    await expect(h.service.downloadErrorRowsCsv(JOB_ID)).rejects.toThrow(
      'access denied',
    );
  });

  it('uses the saved user locale when no supported request language is supplied', async () => {
    arrangeSource();
    h.prisma.user.findUnique.mockResolvedValue({ id: 'admin', locale: 'en' });
    const csv = await consumeCsv(await h.service.downloadErrorRowsCsv(JOB_ID));
    expect(csv).toContain(
      'This row could not be imported. Try importing it again.',
    );
  });

  it('does not fetch another tenant’s rows or upload', async () => {
    h.prisma.importJob.findFirst.mockResolvedValue(null);
    await expect(
      h.service.downloadErrorRowsCsv('foreign-job'),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: IMPORT_ERROR_CODES.JOB_NOT_FOUND },
    });
    expect(h.prisma.importJobRow.findMany).not.toHaveBeenCalled();
    expect(h.fileStorage.openReadStream).not.toHaveBeenCalled();
  });

  it('rejects SALES before fetching the job', async () => {
    h.tenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'sales',
      role: 'SALES',
    });
    await expect(h.service.downloadErrorRowsCsv(JOB_ID)).rejects.toMatchObject({
      status: 403,
    });
    expect(h.prisma.importJob.findFirst).not.toHaveBeenCalled();
  });

  it('closes the stored upload when a download is cancelled before reading', async () => {
    arrangeSource();
    const input = Readable.from([Buffer.from(source)]);
    h.fileStorage.openReadStream.mockReturnValue(input);
    const report = await h.service.downloadErrorRowsCsv(JOB_ID);
    expect(h.prisma.importJobRow.findMany).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => {
      report.once('close', resolve);
      report.destroy();
    });
    expect(input.destroyed).toBe(true);
  });

  it('retains original headers before a stored-upload background job starts', async () => {
    h.cloudTasks.isEnabled.mockReturnValue(true);
    h.fileStorage.openReadStream.mockImplementation(() =>
      Readable.from([
        Buffer.from(
          'Source ID;"  Original description  ";Unused\r\nA-1;Sample;extra\r\n',
        ),
      ]),
    );
    await h.service.createDryRunFromStoredUpload({
      jobId: JOB_ID,
      ref: { object_key: 'tenant-1/job-1/source.csv' },
      fileName: 'source.csv',
      entityType: ImportEntityType.CUSTOMER,
      sourceSystem: 'synthetic',
      mappingJson: mapping,
      optionsJson: {},
      fileSha256: 'synthetic-sha',
      rowCount: 1,
    });
    expect(h.prisma.importJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          options_json: expect.objectContaining({
            upload: {
              object_key: 'tenant-1/job-1/source.csv',
              headers: ['Source ID', '  Original description  ', 'Unused'],
            },
          }),
        }),
      }),
    );
  });

  it('retains small synchronous uploads and original header metadata', async () => {
    await h.service.createDryRunFromUpload(
      dryRunParams(ImportEntityType.CUSTOMER, source, { mappingJson: mapping }),
    );
    expect(h.fileStorage.storeUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        content: Buffer.from(source),
      }),
    );
    expect(h.prisma.importJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          options_json: expect.objectContaining({
            upload: expect.objectContaining({
              object_key: 'tenant-1/job-1/source.csv',
              headers: ['Source ID', 'Given name', 'Family name', 'Unused'],
            }),
          }),
        }),
      }),
    );
  });
});
