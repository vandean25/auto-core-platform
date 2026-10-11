import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetClient = jest.fn();
const mockGetTraceData = jest.fn();

jest.unstable_mockModule('@sentry/node', () => ({
  getClient: mockGetClient,
  getTraceData: mockGetTraceData,
  startSpan: jest.fn(),
  getActiveSpan: jest.fn(),
  getCurrentScope: jest.fn(),
  getIsolationScope: jest.fn(),
}));

const { buildTaskRequest } = await import('./cloud-tasks.service.js');

const params = {
  url: 'https://worker.example.test/api/invoices/inv-1/pdf/worker',
  workerSecret: 'worker-secret-value',
  tenantId: 'tenant-1',
  payload: { kind: 'invoice', resourceId: 'inv-1', tenantId: 'tenant-1' },
  invokerServiceAccount: 'invoker@example.test',
  targetBaseUrl: 'https://worker.example.test/api',
};

const sentryTrace = `${'a'.repeat(32)}-${'b'.repeat(16)}-1`;

describe('buildTaskRequest trace headers', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    mockGetTraceData.mockReset();
  });

  it('forwards sentry-trace and baggage so the worker joins the request trace', () => {
    mockGetClient.mockReturnValue({});
    mockGetTraceData.mockReturnValue({
      'sentry-trace': sentryTrace,
      baggage: 'sentry-environment=qa',
    });

    const task = buildTaskRequest(params);

    expect(task.httpRequest.headers).toEqual({
      'Content-Type': 'application/json',
      'x-cloud-tasks-secret': 'worker-secret-value',
      'x-tenant-id': 'tenant-1',
      'sentry-trace': sentryTrace,
      baggage: 'sentry-environment=qa',
    });
  });

  it('adds no trace headers when Sentry is not initialised', () => {
    mockGetClient.mockReturnValue(undefined);

    const task = buildTaskRequest(params);

    expect(Object.keys(task.httpRequest.headers).sort()).toEqual([
      'Content-Type',
      'x-cloud-tasks-secret',
      'x-tenant-id',
    ]);
    expect(mockGetTraceData).not.toHaveBeenCalled();
  });

  it('leaves the signed body unchanged', () => {
    mockGetClient.mockReturnValue({});
    mockGetTraceData.mockReturnValue({ 'sentry-trace': sentryTrace });

    const task = buildTaskRequest(params);

    expect(task.httpRequest.body.toString()).toBe(
      JSON.stringify(params.payload),
    );
  });
});
