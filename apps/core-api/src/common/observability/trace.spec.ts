import { beforeEach, describe, it, expect, jest } from '@jest/globals';

const mockStartSpan = jest.fn();
const mockGetClient = jest.fn();
const mockGetActiveSpan = jest.fn();
const mockGetCurrentScope = jest.fn();
const mockGetIsolationScope = jest.fn();
const mockGetTraceData = jest.fn();

jest.unstable_mockModule('@sentry/node', () => ({
  startSpan: mockStartSpan,
  getClient: mockGetClient,
  getActiveSpan: mockGetActiveSpan,
  getCurrentScope: mockGetCurrentScope,
  getIsolationScope: mockGetIsolationScope,
  getTraceData: mockGetTraceData,
}));

const {
  APP_TRACE_ID_TAG,
  getActiveTraceId,
  getSentryTraceHeaders,
  linkAppTraceIdToSentry,
  sanitizeSpanAttributes,
  setActiveSpanAttributes,
  toByteSizeBucket,
  withSpan,
  withStatusSpan,
} = await import('./trace.js');

function sentryInitialised(): void {
  mockGetClient.mockReturnValue({});
}

function fakeSpan(traceId = 'a'.repeat(32)) {
  return {
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
    spanContext: () => ({ traceId, spanId: 'b'.repeat(16) }),
  };
}

describe('withSpan', () => {
  beforeEach(() => {
    mockStartSpan.mockReset();
    mockGetClient.mockReset();
  });

  it('is a passthrough when Sentry is not initialised', async () => {
    mockGetClient.mockReturnValue(undefined);

    const result = withSpan('Finalize invoice', 'invoice.finalize', {}, (span) => {
      span.setAttribute('outcome', 'finalized');
      return 42;
    });
    const asyncResult = await withSpan(
      'Extract branding',
      'branding.extract',
      {},
      async () => 'done',
    );

    expect(result).toBe(42);
    expect(asyncResult).toBe('done');
    expect(mockStartSpan).not.toHaveBeenCalled();
  });

  it('rethrows errors unchanged when Sentry is not initialised', async () => {
    mockGetClient.mockReturnValue(undefined);
    const failure = new Error('boom');

    await expect(
      withSpan('Agent action', 'agent.action', {}, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('starts a Sentry span with the name, op and sanitized attributes', () => {
    sentryInitialised();
    const span = fakeSpan();
    mockStartSpan.mockImplementation((_options, callback) =>
      (callback as (s: unknown) => unknown)(span),
    );

    const result = withSpan(
      'Finalize invoice',
      'invoice.finalize',
      { invoiceId: 'inv-1', nested: { a: 1 }, list: [1], nothing: undefined },
      () => 'ok',
    );

    expect(result).toBe('ok');
    expect(mockStartSpan).toHaveBeenCalledWith(
      {
        name: 'Finalize invoice',
        op: 'invoice.finalize',
        attributes: { invoiceId: 'inv-1' },
      },
      expect.any(Function),
    );
  });

  it('strips non-primitive values from attributes set later on the span', () => {
    sentryInitialised();
    const span = fakeSpan();
    mockStartSpan.mockImplementation((_options, callback) =>
      (callback as (s: unknown) => unknown)(span),
    );

    withSpan('Agent action', 'agent.action', {}, (handle) => {
      handle.setAttribute('agent.action.type', 'mcp.reserve_part');
      handle.setAttribute('payload', { text: 'customer note' });
      handle.setAttributes({ 'agent.policy.tier': 'AUTO', fn: () => 1 });
    });

    expect(span.setAttribute).toHaveBeenCalledWith(
      'agent.action.type',
      'mcp.reserve_part',
    );
    expect(span.setAttribute).not.toHaveBeenCalledWith(
      'payload',
      expect.anything(),
    );
    expect(span.setAttributes).toHaveBeenCalledWith({
      'agent.policy.tier': 'AUTO',
    });
  });
});

describe('sanitizeSpanAttributes', () => {
  it('keeps finite numbers, booleans and short strings', () => {
    expect(
      sanitizeSpanAttributes({
        count: 3,
        flag: false,
        nan: Number.NaN,
        infinite: Number.POSITIVE_INFINITY,
        id: 'asset-1',
      }),
    ).toEqual({ count: 3, flag: false, id: 'asset-1' });
  });

  it('truncates long strings so free text cannot flood a span', () => {
    const sanitized = sanitizeSpanAttributes({ value: 'x'.repeat(500) });
    expect(sanitized.value).toHaveLength(200);
  });

  it('drops keys that name personal data or document content', () => {
    expect(
      sanitizeSpanAttributes({
        email: 'person@example.test',
        customer_name: 'Max Muster',
        display_name: 'Max',
        phone: '+43 1 000',
        prompt: 'extract the logo',
        extracted_text: 'Musterwerkstatt',
        body: 'raw body',
        token: 'abc',
        asset_id: 'b1c2d3e4-0000-4000-8000-000000000001',
      }),
    ).toEqual({ asset_id: 'b1c2d3e4-0000-4000-8000-000000000001' });
  });
});

describe('getActiveTraceId', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    mockGetActiveSpan.mockReset();
    mockGetCurrentScope.mockReset();
  });

  it('returns undefined when Sentry is not initialised', () => {
    mockGetClient.mockReturnValue(undefined);

    expect(getActiveTraceId()).toBeUndefined();
    expect(mockGetActiveSpan).not.toHaveBeenCalled();
  });

  it('returns the trace id of the active span', () => {
    sentryInitialised();
    mockGetActiveSpan.mockReturnValue(fakeSpan('c'.repeat(32)));

    expect(getActiveTraceId()).toBe('c'.repeat(32));
  });

  it('falls back to the propagation context when no span is active', () => {
    sentryInitialised();
    mockGetActiveSpan.mockReturnValue(undefined);
    mockGetCurrentScope.mockReturnValue({
      getPropagationContext: () => ({ traceId: 'd'.repeat(32) }),
    });

    expect(getActiveTraceId()).toBe('d'.repeat(32));
  });
});

describe('getSentryTraceHeaders', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    mockGetTraceData.mockReset();
  });

  it('returns no headers when Sentry is not initialised', () => {
    mockGetClient.mockReturnValue(undefined);

    expect(getSentryTraceHeaders()).toEqual({});
    expect(mockGetTraceData).not.toHaveBeenCalled();
  });

  it('returns the sentry-trace and baggage headers for the active trace', () => {
    sentryInitialised();
    mockGetTraceData.mockReturnValue({
      'sentry-trace': 'trace-id-span-id-1',
      baggage: 'sentry-environment=qa',
    });

    expect(getSentryTraceHeaders()).toEqual({
      'sentry-trace': 'trace-id-span-id-1',
      baggage: 'sentry-environment=qa',
    });
  });

  it('omits trace data that is not a string', () => {
    sentryInitialised();
    mockGetTraceData.mockReturnValue({ 'sentry-trace': undefined });

    expect(getSentryTraceHeaders()).toEqual({});
  });
});

describe('linkAppTraceIdToSentry', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    mockGetIsolationScope.mockReset();
  });

  it('does nothing when Sentry is not initialised', () => {
    mockGetClient.mockReturnValue(undefined);

    linkAppTraceIdToSentry('e1e2e3e4-0000-4000-8000-000000000002');

    expect(mockGetIsolationScope).not.toHaveBeenCalled();
  });

  it('tags the request isolation scope with the app trace id', () => {
    sentryInitialised();
    const setTag = jest.fn();
    mockGetIsolationScope.mockReturnValue({ setTag });

    linkAppTraceIdToSentry('e1e2e3e4-0000-4000-8000-000000000002');

    expect(APP_TRACE_ID_TAG).toBe('app.trace_id');
    expect(setTag).toHaveBeenCalledWith(
      'app.trace_id',
      'e1e2e3e4-0000-4000-8000-000000000002',
    );
  });
});

describe('toByteSizeBucket', () => {
  it('buckets byte sizes so exact document sizes are never recorded', () => {
    const kb = 1024;
    const mb = 1024 * kb;

    expect(toByteSizeBucket(0)).toBe('lt_100kb');
    expect(toByteSizeBucket(100 * kb - 1)).toBe('lt_100kb');
    expect(toByteSizeBucket(100 * kb)).toBe('100kb_1mb');
    expect(toByteSizeBucket(mb - 1)).toBe('100kb_1mb');
    expect(toByteSizeBucket(mb)).toBe('1mb_5mb');
    expect(toByteSizeBucket(5 * mb)).toBe('5mb_10mb');
    expect(toByteSizeBucket(10 * mb)).toBe('gte_10mb');
  });

  it('reports unknown for sizes that are not usable', () => {
    expect(toByteSizeBucket(Number.NaN)).toBe('unknown');
    expect(toByteSizeBucket(-1)).toBe('unknown');
  });
});

describe('withStatusSpan', () => {
  beforeEach(() => {
    mockStartSpan.mockReset();
    mockGetClient.mockReset();
  });

  it('records status ok and returns the result', async () => {
    sentryInitialised();
    const span = fakeSpan();
    mockStartSpan.mockImplementation((_options, callback) =>
      (callback as (s: unknown) => unknown)(span),
    );

    await expect(
      withStatusSpan('Parse source', 'branding.extract.parse', {}, async () => 7),
    ).resolves.toBe(7);
    expect(span.setAttribute).toHaveBeenCalledWith('status', 'ok');
  });

  it('records status failed and rethrows the same error', async () => {
    sentryInitialised();
    const span = fakeSpan();
    mockStartSpan.mockImplementation((_options, callback) =>
      (callback as (s: unknown) => unknown)(span),
    );
    const failure = new Error('parser timeout');

    await expect(
      withStatusSpan('Parse source', 'branding.extract.parse', {}, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(span.setAttribute).toHaveBeenCalledWith('status', 'failed');
  });
});

describe('setActiveSpanAttributes', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    mockGetActiveSpan.mockReset();
  });

  it('does nothing when Sentry is not initialised', () => {
    mockGetClient.mockReturnValue(undefined);

    setActiveSpanAttributes({ 'agent.trace_id': 'f1f2f3f4-0000-4000-8000-000000000003' });

    expect(mockGetActiveSpan).not.toHaveBeenCalled();
  });

  it('writes sanitized attributes onto the active span', () => {
    sentryInitialised();
    const span = fakeSpan();
    mockGetActiveSpan.mockReturnValue(span);

    setActiveSpanAttributes({
      'agent.trace_id': 'f1f2f3f4-0000-4000-8000-000000000003',
      email: 'person@example.test',
    });

    expect(span.setAttributes).toHaveBeenCalledWith({
      'agent.trace_id': 'f1f2f3f4-0000-4000-8000-000000000003',
    });
  });

  it('skips the write when no span is active', () => {
    sentryInitialised();
    mockGetActiveSpan.mockReturnValue(undefined);

    expect(() =>
      setActiveSpanAttributes({ 'agent.trace_id': 'x' }),
    ).not.toThrow();
  });
});
