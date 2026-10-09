import {
  capMcpToolPayload,
  decodeMcpCursor,
  encodeMcpCursor,
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
