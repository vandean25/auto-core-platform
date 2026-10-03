import { REDACTED_VALUE } from '../audit/audit-redaction.util.js';
import {
  AGENT_ACTION_SUMMARY_MAX_BYTES,
  AGENT_ACTION_SUMMARY_TRUNCATED_MARKER,
  capAgentActionSummary,
  redactAgentActionSummary,
} from './agent-action-summary.util.js';

describe('agent-action-summary.util', () => {
  it('redacts secret keys from summaries', () => {
    const result = redactAgentActionSummary({
      action: 'sync',
      authorization: 'Bearer secret',
      apiKey: 'key-123',
      accessToken: 'tok',
      token: 'sekret',
      secret: 's3',
      nested: { token: 'nested-token' },
    });

    expect(result).toEqual({
      action: 'sync',
      authorization: REDACTED_VALUE,
      apiKey: REDACTED_VALUE,
      accessToken: REDACTED_VALUE,
      token: REDACTED_VALUE,
      secret: REDACTED_VALUE,
      nested: { token: REDACTED_VALUE },
    });
  });

  it('marks oversized payloads as truncated with a bounded stored size', () => {
    const huge = { payload: 'x'.repeat(20_000) };
    const capped = capAgentActionSummary(huge);

    expect(capped).toMatchObject({
      [AGENT_ACTION_SUMMARY_TRUNCATED_MARKER]: true,
      originalBytes: expect.any(Number),
      preview: expect.any(String),
    });
    expect(capped).not.toHaveProperty('payload');
    expect(JSON.stringify(capped).length).toBeLessThan(
      AGENT_ACTION_SUMMARY_MAX_BYTES,
    );
  });
});
