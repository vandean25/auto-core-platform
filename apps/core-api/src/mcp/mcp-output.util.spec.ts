import {
  capMcpToolPayload,
  capMcpValue,
  decodeMcpCursor,
  decodeMcpKeysetCursor,
  encodeMcpCursor,
  encodeMcpKeysetCursor,
  fitMcpRowsToCap,
  normalizeMcpRangeEnd,
  normalizeMcpRangeStart,
} from './mcp-output.util.js';

describe('capMcpToolPayload', () => {
  it('includes a JSON preview when the payload is oversized', () => {
    const large = { data: 'x'.repeat(40_000) };
    const capped = capMcpToolPayload(large) as Record<string, unknown>;
    expect(capped.__truncated__).toBe(true);
    expect(typeof capped.preview).toBe('string');
    expect((capped.preview as string).length).toBe(1024);
    expect(capped.originalBytes).toBeGreaterThan(32_768);
  });
});

describe('MCP paging cursor', () => {
  it('round-trips the offset it encodes', () => {
    expect(decodeMcpCursor(encodeMcpCursor(0))).toBe(0);
    expect(decodeMcpCursor(encodeMcpCursor(25))).toBe(25);
  });

  it('rejects values that were not issued as cursors', () => {
    expect(decodeMcpCursor('')).toBeNull();
    expect(decodeMcpCursor('not a cursor!')).toBeNull();
    expect(decodeMcpCursor(Buffer.from('abc').toString('base64url'))).toBeNull();
    expect(decodeMcpCursor(Buffer.from('-1').toString('base64url'))).toBeNull();
  });
});

describe('MCP keyset cursor', () => {
  const at = '2026-10-10T08:00:00.000Z';
  const id = '00000000-0000-4000-8000-0000000000a1';

  it('round-trips the timestamp and row ID it encodes', () => {
    expect(decodeMcpKeysetCursor(encodeMcpKeysetCursor({ at, id }))).toEqual({
      at,
      id,
    });
  });

  it('rejects values that were not issued as keyset cursors', () => {
    expect(decodeMcpKeysetCursor('')).toBeNull();
    expect(decodeMcpKeysetCursor('not a cursor!')).toBeNull();
    expect(
      decodeMcpKeysetCursor(Buffer.from('not json').toString('base64url')),
    ).toBeNull();
    expect(
      decodeMcpKeysetCursor(encodeMcpKeysetCursor({ at: 'yesterday', id })),
    ).toBeNull();
    expect(
      decodeMcpKeysetCursor(encodeMcpKeysetCursor({ at, id: 'row-1' })),
    ).toBeNull();
  });

  it('does not accept offset cursors, or the reverse', () => {
    expect(decodeMcpKeysetCursor(encodeMcpCursor(10))).toBeNull();
    expect(decodeMcpCursor(encodeMcpKeysetCursor({ at, id }))).toBeNull();
  });
});

describe('MCP result size helpers', () => {
  it('returns a value unchanged when it fits', () => {
    expect(capMcpValue({ a: 1 }, 64)).toEqual({ a: 1 });
  });

  it('replaces an oversized value with a marker that reports its size', () => {
    const capped = capMcpValue('x'.repeat(1000), 100) as Record<
      string,
      unknown
    >;

    expect(capped.__truncated__).toBe(true);
    expect(capped.originalBytes).toBe(1002);
    expect((capped.preview as string).length).toBe(50);
  });

  it('keeps the leading rows that fit and reports the rest as truncated', () => {
    const rows = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
    const envelope = (kept: readonly string[]) => ({ data: kept });

    expect(fitMcpRowsToCap(rows, envelope, 100)).toEqual({
      rows: rows.slice(0, 2),
      truncated: true,
    });
  });

  it('keeps every row when all of them fit', () => {
    const envelope = (kept: readonly string[]) => ({ data: kept });

    expect(fitMcpRowsToCap(['a', 'b'], envelope, 1000)).toEqual({
      rows: ['a', 'b'],
      truncated: false,
    });
  });

  it('expands a bare date to the whole UTC day for an inclusive range', () => {
    expect(normalizeMcpRangeStart('2026-10-01')).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(normalizeMcpRangeEnd('2026-10-31')).toBe(
      '2026-10-31T23:59:59.999Z',
    );
    expect(normalizeMcpRangeEnd('2026-10-31T12:00:00Z')).toBe(
      '2026-10-31T12:00:00Z',
    );
  });
});
