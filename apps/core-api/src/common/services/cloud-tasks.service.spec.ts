import { CloudTasksService } from './cloud-tasks.service.js';
import { verifyPdfTaskPayload } from '../pdf/pdf-task-payload.js';
import { verifyDocumentBrandingUploadTask } from '../../document-branding/document-branding-upload-task.js';
import { verifyDocumentBrandingExtractionTask } from '../../document-branding/document-branding-extraction-task.js';

describe('CloudTasksService', () => {
  const originalEnv = { ...process.env };
  const workerSecret = 'worker-secret';
  const invokerServiceAccount =
    'cloud-tasks-pdf-invoker@auto-core-platform.iam.gserviceaccount.com';

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.CLOUD_TASKS_WORKER_SECRET = workerSecret;
    process.env.CLOUD_TASKS_LOCATION = 'europe-west3';
    process.env.CLOUD_TASKS_QUEUE = 'pdf-queue';
    process.env.CLOUD_TASKS_ENABLED = 'true';
    process.env.CLOUD_TASKS_INVOKER_SA = invokerServiceAccount;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function createService() {
    const service = new CloudTasksService();
    const createTask = jest.fn();
    const queuePath = jest
      .fn()
      .mockReturnValue('projects/test/queues/pdf-queue');
    const taskPath = jest.fn(
      (_project: string, _location: string, _queue: string, task: string) =>
        `projects/test-project/locations/europe-west3/queues/pdf-queue/tasks/${task}`,
    );
    const getTask = jest.fn();

    (
      service as unknown as {
        client: {
          createTask: jest.Mock;
          queuePath: jest.Mock;
          taskPath: jest.Mock;
          getTask: jest.Mock;
        };
      }
    ).client = {
      createTask,
      queuePath,
      taskPath,
      getTask,
    };

    return { service, createTask, getTask, queuePath, taskPath };
  }

  function decodeTaskBody(createTask: jest.Mock): unknown {
    const request = createTask.mock.calls[0][0];
    const body = request.task.httpRequest.body as Buffer;
    return JSON.parse(Buffer.from(body).toString('utf8'));
  }

  it('creates invoice pdf tasks with a signed tenant payload', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test-project/locations/europe-west3/queues/pdf-queue/tasks/generated-invoice-task',
      },
    ]);

    await expect(
      service.enqueuePdfGeneration({
        kind: 'invoice',
        resourceId: 'invoice-1',
        targetBaseUrl: 'https://app.example.com/api',
        tenantId: 'tenant-1',
      }),
    ).resolves.toEqual({ taskId: 'generated-invoice-task' });

    const request = createTask.mock.calls[0][0];
    expect(request.task.name).toBeUndefined();
    expect(request.task.httpRequest.url).toBe(
      'https://app.example.com/api/invoices/invoice-1/pdf/worker',
    );
    expect(request.task.httpRequest.headers['x-tenant-id']).toBe('tenant-1');
    expect(request.task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: invokerServiceAccount,
      audience: 'https://app.example.com',
    });

    const payload = decodeTaskBody(createTask);
    expect(verifyPdfTaskPayload(payload, workerSecret)).toEqual({
      kind: 'invoice',
      resourceId: 'invoice-1',
      tenantId: 'tenant-1',
    });
  });

  it('creates workshop pdf tasks with a signed tenant payload', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test-project/locations/europe-west3/queues/pdf-queue/tasks/generated-workshop-task',
      },
    ]);

    await expect(
      service.enqueuePdfGeneration({
        kind: 'workshop-order',
        resourceId: 'workshop-1',
        targetBaseUrl: 'https://app.example.com/api',
        tenantId: 'tenant-1',
      }),
    ).resolves.toEqual({ taskId: 'generated-workshop-task' });

    const request = createTask.mock.calls[0][0];
    expect(request.task.name).toBeUndefined();
    expect(request.task.httpRequest.url).toBe(
      'https://app.example.com/api/workshop/orders/workshop-1/pdf/worker',
    );
    expect(request.task.httpRequest.headers['x-tenant-id']).toBe('tenant-1');
    expect(request.task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: invokerServiceAccount,
      audience: 'https://app.example.com',
    });

    const payload = decodeTaskBody(createTask);
    expect(verifyPdfTaskPayload(payload, workerSecret)).toEqual({
      kind: 'workshop-order',
      resourceId: 'workshop-1',
      tenantId: 'tenant-1',
    });
  });

  it('creates a distinct signed document branding validation task', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test/locations/europe-west3/queues/pdf-queue/tasks/brand-validation',
      },
    ]);
    await expect(
      service.enqueueDocumentBrandingAssetValidation({
        assetId: 'asset-1',
        tenantId: 'tenant-1',
        targetBaseUrl: 'https://app.example.com/api',
      }),
    ).resolves.toEqual({ taskId: 'brand-validation' });

    const request = createTask.mock.calls[0][0];
    expect(request.task.httpRequest.url).toBe(
      'https://app.example.com/api/document-branding/assets/asset-1/worker',
    );
    expect(
      verifyDocumentBrandingUploadTask(
        decodeTaskBody(createTask),
        workerSecret,
      ),
    ).toEqual({
      assetId: 'asset-1',
      tenantId: 'tenant-1',
    });
  });

  it('creates a tenant and entity bound extraction task with a worker deadline', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test/locations/europe-west3/queues/pdf-queue/tasks/brand-extraction',
      },
    ]);
    await expect(
      service.enqueueDocumentBrandingExtraction({
        extractionId: 'extraction-1',
        legalEntityId: 'entity-1',
        tenantId: 'tenant-1',
        expectedAttemptCount: 0,
        targetBaseUrl: 'https://app.example.com/api',
        delaySeconds: 20,
      }),
    ).resolves.toEqual({ taskId: 'brand-extraction' });

    const request = createTask.mock.calls[0][0];
    expect(request.task.httpRequest.url).toBe(
      'https://app.example.com/api/legal-entities/entity-1/document-branding/extractions/extraction-1/worker',
    );
    expect(request.task.dispatchDeadline).toEqual({ seconds: 60 });
    expect(request.task.scheduleTime).toEqual({
      seconds: expect.any(Number),
    });
    expect(request.task.name).toMatch(
      /\/tasks\/document-branding-extraction-[a-f0-9]{40}$/,
    );
    expect(
      verifyDocumentBrandingExtractionTask(
        decodeTaskBody(createTask),
        workerSecret,
      ),
    ).toEqual({
      extractionId: 'extraction-1',
      legalEntityId: 'entity-1',
      tenantId: 'tenant-1',
      expectedAttemptCount: 0,
    });
  });

  it('accepts an already-existing task when it is still present in the queue', async () => {
    const { service, createTask, getTask } = createService();
    createTask.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 6 }),
    );
    getTask.mockImplementationOnce(({ name }: { name: string }) =>
      Promise.resolve([{ name }]),
    );

    await expect(
      service.enqueueDocumentBrandingExtraction({
        extractionId: 'extraction-1',
        legalEntityId: 'entity-1',
        tenantId: 'tenant-1',
        expectedAttemptCount: 0,
        targetBaseUrl: 'https://app.example.com/api',
      }),
    ).resolves.toMatchObject({
      taskId: expect.stringMatching(/^document-branding-extraction-[a-f0-9]{40}$/),
    });

    const activeTaskName = createTask.mock.calls[0][0].task.name;
    expect(getTask).toHaveBeenCalledWith({ name: activeTaskName });
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it('uses a fresh task name when ALREADY_EXISTS refers to a deleted task tombstone', async () => {
    const { service, createTask, getTask } = createService();
    createTask
      .mockRejectedValueOnce(
        Object.assign(new Error('recently deleted'), { code: 6 }),
      )
      .mockResolvedValueOnce([
        {
          name: 'projects/test/locations/europe-west3/queues/pdf-queue/tasks/fresh-dispatch',
        },
      ]);
    getTask.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 5 }));

    await expect(
      service.enqueueDocumentBrandingExtraction({
        extractionId: 'extraction-1',
        legalEntityId: 'entity-1',
        tenantId: 'tenant-1',
        expectedAttemptCount: 0,
        targetBaseUrl: 'https://app.example.com/api',
      }),
    ).resolves.toEqual({ taskId: 'fresh-dispatch' });

    expect(createTask).toHaveBeenCalledTimes(2);
    expect(createTask.mock.calls[0][0].task.name).not.toBe(
      createTask.mock.calls[1][0].task.name,
    );
  });

  it('throws when CLOUD_TASKS_INVOKER_SA is missing', async () => {
    delete process.env.CLOUD_TASKS_INVOKER_SA;
    const { service } = createService();

    await expect(
      service.enqueuePdfGeneration({
        kind: 'invoice',
        resourceId: 'invoice-1',
        targetBaseUrl: 'https://app.example.com/api',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow(/Cloud Tasks is not enabled or not configured/);
  });
});
