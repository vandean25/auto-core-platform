import { BadRequestException } from '@nestjs/common';
import { readCsvDataRowSliceFromPull } from './csv-incremental.parser.js';
import { readWorkerCsvBatchFromRanges } from './import-csv-stream.util.js';
import { IMPORT_READ_RANGE_BYTES } from './import-file.storage.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';

const MULTI_BYTE_CHARS = [
  { label: '2-byte', char: 'ü' },
  { label: '3-byte', char: '€' },
  { label: '4-byte', char: '𝄞' },
];

function pullFromCuts(
  file: Buffer,
  cuts: number[],
): () => Promise<Buffer | null> {
  const bounds = [0, ...cuts, file.length];
  let index = 0;
  return async () => {
    if (index >= bounds.length - 1) {
      return null;
    }
    const chunk = file.subarray(bounds[index], bounds[index + 1]);
    index += 1;
    return chunk;
  };
}

function workerAt(
  processed: number,
  offset: number,
  headers?: string[],
  delimiter?: ';' | ',',
): ImportJobWorkerState {
  return {
    phase: 'dry_run',
    lease_token: 'lease',
    lease_until: new Date(0).toISOString(),
    processed_rows: processed,
    started_at: new Date(0).toISOString(),
    csv_next_byte: offset,
    csv_headers: headers,
    csv_delimiter: delimiter,
  };
}

describe('range boundary inside a multi-byte character', () => {
  for (const { label, char } of MULTI_BYTE_CHARS) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    for (let split = 1; split < charBytes; split += 1) {
      it(`reads a batch when the range ends ${split} byte(s) into a ${label} character`, async () => {
        const file = Buffer.from(
          `nr;name\n1;Strasse\n2;M${char}ller\n3;Weiss\n`,
          'utf8',
        );
        const charStart = file.indexOf(Buffer.from(char, 'utf8'));
        const slice = await readCsvDataRowSliceFromPull(
          pullFromCuts(file, [charStart + split]),
          0,
          1,
        );
        expect(slice?.rows).toEqual([['1', 'Strasse']]);
        expect(slice?.nextByteOffset).toBe(
          file.indexOf(Buffer.from('2;', 'utf8')),
        );
      });
    }
  }

  it('continues at the next row after a boundary split', async () => {
    const file = Buffer.from('nr;name\n1;Grün\n2;Blau\n3;Weiß\n', 'utf8');
    const first = await readCsvDataRowSliceFromPull(
      pullFromCuts(file, [file.indexOf(Buffer.from('ü', 'utf8')) + 1]),
      0,
      1,
    );
    const second = await readCsvDataRowSliceFromPull(
      pullFromCuts(file.subarray(first?.nextByteOffset ?? 0), []),
      0,
      2,
      {
        headers: first?.headers,
        delimiter: first?.delimiter,
        absoluteStart: first?.nextByteOffset,
      },
    );
    expect(first?.rows).toEqual([['1', 'Grün']]);
    expect(second?.rows).toEqual([
      ['2', 'Blau'],
      ['3', 'Weiß'],
    ]);
    expect(second?.nextByteOffset).toBe(file.length);
  });

  it('rejects a byte sequence that is not valid UTF-8', async () => {
    const file = Buffer.concat([
      Buffer.from('nr;name\n1;M', 'utf8'),
      Buffer.from([0xfc]),
      Buffer.from('ller\n2;Blau\n', 'utf8'),
    ]);
    await expect(
      readCsvDataRowSliceFromPull(pullFromCuts(file, []), 0, 1),
    ).rejects.toMatchObject({
      response: { code: IMPORT_ERROR_CODES.INVALID_ENCODING },
    });
  });

  it('rejects a truncated character at the real end of the file', async () => {
    const file = Buffer.concat([
      Buffer.from('nr;name\n1;Blau\n2;M', 'utf8'),
      Buffer.from([0xc3]),
    ]);
    await expect(
      readCsvDataRowSliceFromPull(pullFromCuts(file, []), 0, 500),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('background dry run over a file larger than one read range', () => {
  const rowBytes = Buffer.byteLength('000001;Müller\n', 'utf8');
  const umlautOffsetInRow = Buffer.byteLength('000001;M', 'utf8');

  function headerPaddingSplittingTheRange(): number {
    for (let padding = 0; padding < rowBytes; padding += 1) {
      const headerBytes = Buffer.byteLength(
        `nr;name${'x'.repeat(padding)}\n`,
        'utf8',
      );
      const offsetInRange =
        IMPORT_READ_RANGE_BYTES - 1 - headerBytes - umlautOffsetInRow;
      if (offsetInRange >= 0 && offsetInRange % rowBytes === 0) {
        return padding;
      }
    }
    throw new Error('no header padding splits the range boundary');
  }

  function buildFile(rowCount: number): Buffer {
    const header = `nr;name${'x'.repeat(headerPaddingSplittingTheRange())}\n`;
    const rows = Array.from(
      { length: rowCount },
      (_, index) => `${String(index + 1).padStart(6, '0')};Müller\n`,
    );
    return Buffer.from(`${header}${rows.join('')}`, 'utf8');
  }

  it('finishes all rows when a read range ends inside a multi-byte character', async () => {
    const rowCount = Math.ceil(IMPORT_READ_RANGE_BYTES / rowBytes) + 1_000;
    const file = buildFile(rowCount);
    expect(file.length).toBeGreaterThan(IMPORT_READ_RANGE_BYTES);
    expect(file[IMPORT_READ_RANGE_BYTES - 1]).toBe(0xc3);

    const readRange = async (start: number, end: number) =>
      file.subarray(start, Math.min(file.length, end + 1));
    let worker = workerAt(0, 0);
    let collected = 0;
    let lastRow: string[] | undefined;
    let batches = 0;
    while (worker.processed_rows < rowCount) {
      const slice = await readWorkerCsvBatchFromRanges(
        readRange,
        worker,
        5_000,
        'sha',
      );
      expect(slice?.rows.length).toBeGreaterThan(0);
      collected += slice?.rows.length ?? 0;
      lastRow = slice?.rows.at(-1);
      worker = workerAt(
        collected,
        slice?.nextByteOffset ?? 0,
        slice?.headers,
        slice?.delimiter,
      );
      batches += 1;
      if (batches > 100) {
        throw new Error('dry run did not finish');
      }
    }
    expect(collected).toBe(rowCount);
    expect(lastRow).toEqual([String(rowCount).padStart(6, '0'), 'Müller']);
  });
});
