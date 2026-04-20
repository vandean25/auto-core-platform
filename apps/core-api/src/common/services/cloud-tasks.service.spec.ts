import { CloudTasksService } from './cloud-tasks.service';

describe('CloudTasksService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.API_KEY = 'test-api-key';
    process.env.CLOUD_TASKS_WORKER_SECRET = 'worker-secret';
    process.env.CLOUD_TASKS_LOCATION = 'europe-west3';
    process.env.CLOUD_TASKS_QUEUE = 'pdf-queue';
    process.env.CLOUD_TASKS_ENABLED = 'true';
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

  it('creates invoice pdf tasks without a deterministic task name', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test-project/locations/europe-west3/queues/pdf-queue/tasks/generated-invoice-task',
      },
    ]);

    await expect(
      service.enqueuePdfGeneration({
        invoiceId: 'invoice-1',
        targetBaseUrl: 'https://app.example.com/api',
      }),
    ).resolves.toEqual({ taskId: 'generated-invoice-task' });

    const request = createTask.mock.calls[0][0];
    expect(request.task.name).toBeUndefined();
    expect(request.task.httpRequest.url).toBe(
      'https://app.example.com/api/invoices/invoice-1/pdf/worker',
    );
  });

  it('creates workshop pdf tasks without a deterministic task name', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test-project/locations/europe-west3/queues/pdf-queue/tasks/generated-workshop-task',
      },
    ]);

    await expect(
      service.enqueueWorkshopPdfGeneration({
        workshopOrderId: 'workshop-1',
        targetBaseUrl: 'https://app.example.com/api',
      }),
    ).resolves.toEqual({ taskId: 'generated-workshop-task' });

    const request = createTask.mock.calls[0][0];
    expect(request.task.name).toBeUndefined();
    expect(request.task.httpRequest.url).toBe(
      'https://app.example.com/api/workshop/orders/workshop-1/pdf/worker',
    );
  });

  it('includes x-tenant-id header when tenantId is provided to enqueuePdfGeneration', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test-project/locations/europe-west3/queues/pdf-queue/tasks/generated-invoice-task',
      },
    ]);

    await service.enqueuePdfGeneration({
      invoiceId: 'invoice-1',
      targetBaseUrl: 'https://app.example.com/api',
      tenantId: 'tenant-abc',
    });

    const request = createTask.mock.calls[0][0];
    expect(request.task.httpRequest.headers['x-tenant-id']).toBe('tenant-abc');
  });

  it('omits x-tenant-id header when tenantId is not provided to enqueuePdfGeneration', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test-project/locations/europe-west3/queues/pdf-queue/tasks/generated-invoice-task',
      },
    ]);

    await service.enqueuePdfGeneration({
      invoiceId: 'invoice-1',
      targetBaseUrl: 'https://app.example.com/api',
    });

    const request = createTask.mock.calls[0][0];
    expect(request.task.httpRequest.headers['x-tenant-id']).toBeUndefined();
  });

  it('includes x-tenant-id header when tenantId is provided to enqueueWorkshopPdfGeneration', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test-project/locations/europe-west3/queues/pdf-queue/tasks/generated-workshop-task',
      },
    ]);

    await service.enqueueWorkshopPdfGeneration({
      workshopOrderId: 'workshop-1',
      targetBaseUrl: 'https://app.example.com/api',
      tenantId: 'tenant-abc',
    });

    const request = createTask.mock.calls[0][0];
    expect(request.task.httpRequest.headers['x-tenant-id']).toBe('tenant-abc');
  });

  it('omits x-tenant-id header when tenantId is not provided to enqueueWorkshopPdfGeneration', async () => {
    const { service, createTask } = createService();
    createTask.mockResolvedValue([
      {
        name: 'projects/test-project/locations/europe-west3/queues/pdf-queue/tasks/generated-workshop-task',
      },
    ]);

    await service.enqueueWorkshopPdfGeneration({
      workshopOrderId: 'workshop-1',
      targetBaseUrl: 'https://app.example.com/api',
    });

    const request = createTask.mock.calls[0][0];
    expect(request.task.httpRequest.headers['x-tenant-id']).toBeUndefined();
  });
});
