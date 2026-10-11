import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';

const mockGetClient = jest.fn();
const mockSetTag = jest.fn();

jest.unstable_mockModule('@sentry/node', () => ({
  getClient: mockGetClient,
  getIsolationScope: () => ({ setTag: mockSetTag }),
  startSpan: jest.fn(),
  getActiveSpan: jest.fn(),
  getCurrentScope: jest.fn(),
  getTraceData: jest.fn(),
}));

const { TenantContextMiddleware } = await import(
  './tenant-context.middleware.js'
);

const INBOUND_TRACE_ID = '0d5b1f7e-1c2d-4a3b-9c8d-7e6f5a4b3c2d';

function runMiddleware(headers: Record<string, string>) {
  const setHeader = jest.fn();
  const next = jest.fn();
  new TenantContextMiddleware().use(
    { headers, ip: '127.0.0.1' } as never,
    { setHeader } as never,
    next as never,
  );
  return { setHeader, next };
}

describe('TenantContextMiddleware app.trace_id link', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    mockSetTag.mockReset();
  });

  it('tags the request scope with the same trace id it echoes to the caller', () => {
    mockGetClient.mockReturnValue({});

    const { setHeader } = runMiddleware({});

    expect(mockSetTag).toHaveBeenCalledTimes(1);
    const [key, value] = mockSetTag.mock.calls[0] as unknown as [
      string,
      string,
    ];
    expect(key).toBe('app.trace_id');
    expect(value).toMatch(/^[0-9a-f-]{36}$/i);
    expect(setHeader).toHaveBeenCalledWith('x-trace-id', value);
  });

  it('uses the inbound x-trace-id for the tag when the caller sends one', () => {
    mockGetClient.mockReturnValue({});

    runMiddleware({ 'x-trace-id': INBOUND_TRACE_ID });

    expect(mockSetTag).toHaveBeenCalledWith('app.trace_id', INBOUND_TRACE_ID);
  });

  it('does not tag the scope when the inbound x-trace-id is invalid', () => {
    mockGetClient.mockReturnValue({});

    expect(() => runMiddleware({ 'x-trace-id': 'not-a-uuid' })).toThrow(
      BadRequestException,
    );
    expect(mockSetTag).not.toHaveBeenCalled();
  });

  it('does not tag the scope when Sentry is not initialised', () => {
    mockGetClient.mockReturnValue(undefined);

    runMiddleware({ 'x-trace-id': INBOUND_TRACE_ID });

    expect(mockSetTag).not.toHaveBeenCalled();
  });
});
