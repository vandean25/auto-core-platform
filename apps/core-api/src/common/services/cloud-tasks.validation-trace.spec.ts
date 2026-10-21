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

const { CloudTasksService } = await import('./cloud-tasks.service.js');

const TRACE_ID = '0d5b1f7e-1c2d-4a3b-9c8d-7e6f5a4b3c2d';
const SENTRY_TRACE = `${'a'.repeat(32)}-${'b'.repeat(16)}-1`;

function createService() {
  const service = new CloudTasksService();
  const createTask = jest.fn<(request: unknown) => Promise<unknown[]>>();
  (
    service as unknown as {
      client: {
        createTask: jest.Mock;
        queuePath: jest.Mock;
        taskPath: jest.Mock<
          (
            project: string,
            location: string,
            queue: string,
            task: string,
          ) => string
        >;
      };
    }
  ).client = {
    createTask,
    queuePath: jest.fn(() => 'projects/test-project/queues/pdf-queue'),
    taskPath: jest.fn(
      (_project: string, _location: string, _queue: string, task: string) =>
        `projects/test-project/queues/pdf-queue/tasks/${task}`,
    ),
  };
  return { service, createTask };
}

describe('enqueueDocumentBrandingAssetValidation trace headers', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    mockGetTraceData.mockReset();
    process.env.CLOUD_TASKS_WORKER_SECRET = 'worker-secret';
    process.env.CLOUD_TASKS_LOCATION = 'europe-west3';
    process.env.CLOUD_TASKS_QUEUE = 'pdf-queue';
    process.env.CLOUD_TASKS_ENABLED = 'true';
    process.env.CLOUD_TASKS_INVOKER_SA =
      'cloud-tasks-pdf-invoker@auto-core-platform.iam.gserviceaccount.com';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
  });

  it('keeps the upload trace id and adds the Sentry trace headers next to it', async () => {
    mockGetClient.mockReturnValue({});
    mockGetTraceData.mockReturnValue({
      'sentry-trace': SENTRY_TRACE,
      baggage: 'sentry-environment=qa',
    });
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      { name: 'projects/test-project/queues/pdf-queue/tasks/validation-1' },
    ]);

    await service.enqueueDocumentBrandingAssetValidation({
      assetId: 'asset-1',
      tenantId: 'tenant-1',
      targetBaseUrl: 'https://worker.example.test/api',
      traceId: TRACE_ID,
    });

    const headers = (
      createTask.mock.calls[0][0] as {
        task: { httpRequest: { headers: Record<string, string> } };
      }
    ).task.httpRequest.headers;
    expect(headers).toMatchObject({
      'x-trace-id': TRACE_ID,
      'x-cloud-tasks-secret': 'worker-secret',
      'sentry-trace': SENTRY_TRACE,
      baggage: 'sentry-environment=qa',
    });
  });

  it('adds no Sentry headers when Sentry is not initialised', async () => {
    mockGetClient.mockReturnValue(undefined);
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      { name: 'projects/test-project/queues/pdf-queue/tasks/validation-2' },
    ]);

    await service.enqueueDocumentBrandingAssetValidation({
      assetId: 'asset-2',
      tenantId: 'tenant-1',
      targetBaseUrl: 'https://worker.example.test/api',
      traceId: TRACE_ID,
    });

    const headers = (
      createTask.mock.calls[0][0] as {
        task: { httpRequest: { headers: Record<string, string> } };
      }
    ).task.httpRequest.headers;
    expect(headers).not.toHaveProperty('sentry-trace');
    expect(headers).not.toHaveProperty('baggage');
    expect(mockGetTraceData).not.toHaveBeenCalled();
  });
});
