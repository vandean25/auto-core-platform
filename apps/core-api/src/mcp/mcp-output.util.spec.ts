import { capMcpToolPayload } from './mcp-output.util.js';

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
