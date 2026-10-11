import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ImportEntityType } from '@prisma/client';
import type { ParsedCsv } from './csv-parse.util.js';
import type { DryRunRowResult } from './import.types.js';

type FakeSpan = {
  name: string;
  op: string;
  attributes: Record<string, unknown>;
  setAttribute: jest.Mock;
  setAttributes: jest.Mock;
};

const mockStartSpan = jest.fn();
const mockGetClient = jest.fn();

jest.unstable_mockModule('@sentry/node', () => ({
  startSpan: mockStartSpan,
  getClient: mockGetClient,
  getActiveSpan: jest.fn(),
  getCurrentScope: jest.fn(),
  getIsolationScope: jest.fn(),
  getTraceData: jest.fn(),
}));

const { traceImportCommit, traceImportParse, traceImportValidate } =
  await import('./import-trace.js');

function recordSpans(): FakeSpan[] {
  const spans: FakeSpan[] = [];
  mockStartSpan.mockImplementation((options, callback) => {
    const opts = options as {
      name: string;
      op: string;
      attributes?: Record<string, unknown>;
    };
    const span: FakeSpan = {
      name: opts.name,
      op: opts.op,
      attributes: { ...opts.attributes },
      setAttribute: jest.fn(),
      setAttributes: jest.fn(),
    };
    spans.push(span);
    return (callback as (s: FakeSpan) => unknown)(span);
  });
  return spans;
}

const parsed: ParsedCsv = {
  headers: ['name', 'email'],
  rows: [
    ['Max Muster', 'max@example.test'],
    ['Erika Beispiel', 'erika@example.test'],
  ],
  sha256: 'a'.repeat(64),
} as unknown as ParsedCsv;

function dryRunRow(
  row_no: number,
  errors: Array<{ code: string; message: string }>,
): DryRunRowResult {
  return {
    row_no,
    external_id: null,
    action: 'CREATE',
    entity_id: null,
    errors,
    warnings: [],
    normalized: { name: 'Max Muster' },
  } as unknown as DryRunRowResult;
}

describe('import stage spans', () => {
  let spans: FakeSpan[];

  beforeEach(() => {
    mockStartSpan.mockReset();
    mockGetClient.mockReset();
    mockGetClient.mockReturnValue({});
    spans = recordSpans();
  });

  it('traceImportParse records the entity type and the row count, and returns the parse result', () => {
    const result = traceImportParse(ImportEntityType.CUSTOMER, () => parsed);

    expect(result).toBe(parsed);
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('Parse import file');
    expect(spans[0].op).toBe('import.parse');
    expect(spans[0].attributes).toEqual({ entity_type: 'CUSTOMER' });
    expect(spans[0].setAttribute).toHaveBeenCalledWith('row_count', 2);
  });

  it('traceImportValidate records row and error counts only, and returns the planned rows', async () => {
    const planned = [
      dryRunRow(1, []),
      dryRunRow(2, [{ code: 'X', message: 'bad' }]),
    ];

    const result = await traceImportValidate(
      ImportEntityType.VEHICLE,
      async () => planned,
    );

    expect(result).toBe(planned);
    expect(spans[0].op).toBe('import.validate');
    expect(spans[0].attributes).toEqual({ entity_type: 'VEHICLE' });
    expect(spans[0].setAttributes).toHaveBeenCalledWith({
      row_count: 2,
      error_row_count: 1,
    });
  });

  it('traceImportCommit records the entity type and the rows applied, and returns the commit result', async () => {
    const serialized = { id: 'job-1' };

    const result = await traceImportCommit(
      ImportEntityType.SUPPLIER_PRICE_LIST,
      5,
      async () => serialized,
    );

    expect(result).toBe(serialized);
    expect(spans[0].name).toBe('Commit import rows');
    expect(spans[0].op).toBe('import.commit');
    expect(spans[0].attributes).toEqual({
      entity_type: 'SUPPLIER_PRICE_LIST',
      row_count: 5,
    });
  });

  it('never records cell values, names, emails or error text', async () => {
    traceImportParse(ImportEntityType.CUSTOMER, () => parsed);
    await traceImportValidate(ImportEntityType.CUSTOMER, async () => [
      dryRunRow(1, [{ code: 'X', message: 'Max Muster has a bad email' }]),
    ]);
    await traceImportCommit(ImportEntityType.CUSTOMER, 2, async () => ({}));

    const recorded = JSON.stringify(
      spans.map((span) => [
        span.attributes,
        span.setAttribute.mock.calls,
        span.setAttributes.mock.calls,
      ]),
    );
    expect(recorded).not.toContain('Max Muster');
    expect(recorded).not.toContain('max@example.test');
    expect(recorded).not.toContain('bad email');
  });

  it('propagates a stage error unchanged', async () => {
    const failure = new Error('db down');

    await expect(
      traceImportCommit(ImportEntityType.CUSTOMER, 1, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('runs without a span when Sentry is not initialised', async () => {
    mockGetClient.mockReturnValue(undefined);

    const result = traceImportParse(ImportEntityType.CUSTOMER, () => parsed);
    await traceImportCommit(ImportEntityType.CUSTOMER, 2, async () => 'ok');

    expect(result).toBe(parsed);
    expect(mockStartSpan).not.toHaveBeenCalled();
  });
});
