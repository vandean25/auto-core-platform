import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { verifyDocumentBrandingUploadTask } from '../../document-branding/document-branding-upload-task.js';
import {
  buildDocumentBrandingAssetValidationRequest,
  createDocumentBrandingExtractionTask,
  type CloudTasksTaskClient,
} from './cloud-tasks.document-branding.js';

const QUEUE_PATH =
  'projects/test-project/locations/europe-west3/queues/pdf-queue';
const WORKER_SECRET = 'worker-secret';
const ENV = {
  workerSecret: WORKER_SECRET,
  invokerServiceAccount: 'invoker@example.test',
};

function createClient() {
  const createTask = jest.fn<(request: unknown) => Promise<unknown[]>>();
  const getTask = jest.fn<(request: unknown) => Promise<unknown[]>>();
  const taskPath = jest.fn(
    (_project: string, _location: string, _queue: string, task: string) =>
      `${QUEUE_PATH}/tasks/${task}`,
  );
  const client = {
    createTask,
    getTask,
    taskPath,
  } as unknown as CloudTasksTaskClient;
  return { client, createTask, getTask, taskPath };
}

describe('createDocumentBrandingExtractionTask', () => {
  let mocks: ReturnType<typeof createClient>;
  const input = {
    parent: QUEUE_PATH,
    taskId: 'document-branding-extraction-abc',
    task: { httpRequest: { url: 'https://worker.example.test/extraction' } },
  };
  const taskPath = (taskId: string) =>
    mocks.taskPath('test-project', 'europe-west3', 'pdf-queue', taskId);

  beforeEach(() => {
    mocks = createClient();
  });

  it('creates the task under its deterministic name', async () => {
    mocks.createTask.mockResolvedValueOnce([
      { name: `${QUEUE_PATH}/tasks/document-branding-extraction-abc` },
    ]);

    await expect(
      createDocumentBrandingExtractionTask(mocks.client, {
        ...input,
        taskPath,
      }),
    ).resolves.toBe(`${QUEUE_PATH}/tasks/document-branding-extraction-abc`);

    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.createTask).toHaveBeenCalledWith({
      parent: QUEUE_PATH,
      task: {
        ...input.task,
        name: `${QUEUE_PATH}/tasks/document-branding-extraction-abc`,
      },
    });
  });

  it('reuses the active task when the deterministic name already exists', async () => {
    mocks.createTask.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 6 }),
    );
    mocks.getTask.mockResolvedValueOnce([
      { name: `${QUEUE_PATH}/tasks/document-branding-extraction-abc` },
    ]);

    await expect(
      createDocumentBrandingExtractionTask(mocks.client, {
        ...input,
        taskPath,
      }),
    ).resolves.toBe(`${QUEUE_PATH}/tasks/document-branding-extraction-abc`);

    expect(mocks.getTask).toHaveBeenCalledWith({
      name: `${QUEUE_PATH}/tasks/document-branding-extraction-abc`,
    });
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });

  it('creates a fresh task when the deterministic name is a deleted tombstone', async () => {
    mocks.createTask
      .mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 6 }))
      .mockResolvedValueOnce([{ name: `${QUEUE_PATH}/tasks/fresh-dispatch` }]);
    mocks.getTask.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 5 }),
    );

    await expect(
      createDocumentBrandingExtractionTask(mocks.client, {
        ...input,
        taskPath,
      }),
    ).resolves.toBe(`${QUEUE_PATH}/tasks/fresh-dispatch`);

    expect(mocks.createTask).toHaveBeenCalledTimes(2);
    const freshName = (
      mocks.createTask.mock.calls[1][0] as { task: { name: string } }
    ).task.name;
    expect(freshName).toMatch(
      /\/tasks\/document-branding-extraction-[0-9a-f-]{36}$/,
    );
    expect(freshName).not.toBe(
      `${QUEUE_PATH}/tasks/document-branding-extraction-abc`,
    );
  });

  it('rethrows create errors that are not ALREADY_EXISTS', async () => {
    const failure = Object.assign(new Error('permission denied'), { code: 7 });
    mocks.createTask.mockRejectedValueOnce(failure);

    await expect(
      createDocumentBrandingExtractionTask(mocks.client, {
        ...input,
        taskPath,
      }),
    ).rejects.toBe(failure);
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it('rethrows lookup errors that are not NOT_FOUND', async () => {
    const failure = Object.assign(new Error('unavailable'), { code: 14 });
    mocks.createTask.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 6 }),
    );
    mocks.getTask.mockRejectedValueOnce(failure);

    await expect(
      createDocumentBrandingExtractionTask(mocks.client, {
        ...input,
        taskPath,
      }),
    ).rejects.toBe(failure);
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });
});

describe('buildDocumentBrandingAssetValidationRequest', () => {
  const url =
    'https://worker.example.test/api/document-branding/assets/asset-1/worker';
  const base = {
    url,
    assetId: 'asset-1',
    tenantId: 'tenant-1',
    targetBaseUrl: 'https://worker.example.test/api',
  };

  it('builds a signed upload-validation request with a 600 second deadline', () => {
    const task = buildDocumentBrandingAssetValidationRequest(
      { ...base, traceId: 'trace-1' },
      ENV,
    );

    expect(task.httpRequest).toMatchObject({
      httpMethod: 'POST',
      url,
      oidcToken: {
        serviceAccountEmail: 'invoker@example.test',
        audience: 'https://worker.example.test',
      },
    });
    expect(task.dispatchDeadline).toEqual({ seconds: 600 });
    expect(
      verifyDocumentBrandingUploadTask(
        JSON.parse(String(task.httpRequest?.body)),
        WORKER_SECRET,
      ),
    ).toEqual({ assetId: 'asset-1', tenantId: 'tenant-1' });
  });

  it('forwards the upload trace id as X-Trace-Id only when one is given', () => {
    const withTrace = buildDocumentBrandingAssetValidationRequest(
      { ...base, traceId: 'trace-1' },
      ENV,
    );
    const withoutTrace = buildDocumentBrandingAssetValidationRequest(base, ENV);

    expect(withTrace.httpRequest?.headers).toMatchObject({
      'x-trace-id': 'trace-1',
      'x-cloud-tasks-secret': WORKER_SECRET,
    });
    expect(withoutTrace.httpRequest?.headers).not.toHaveProperty('x-trace-id');
  });
});
