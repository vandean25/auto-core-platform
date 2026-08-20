import { CloudTasksService } from './cloud-tasks.service';
import { verifyPdfTaskPayload } from '../pdf/pdf-task-payload';

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

    (
      service as unknown as {
        client: {
          createTask: jest.Mock;
          queuePath: jest.Mock;
        };
      }
    ).client = {
      createTask,
      queuePath,
    };

    return { service, createTask, queuePath };
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
