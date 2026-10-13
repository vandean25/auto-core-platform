import { InternalServerErrorException } from '@nestjs/common';
import { NotificationCloudTasksService } from './notification-cloud-tasks.service.js';

const QUEUE_ENV = {
  CLOUD_TASKS_NOTIFICATION_QUEUE: 'notification-queue',
  CLOUD_TASKS_LOCATION: 'europe-west3',
  CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: 'https://worker.example/api',
  CLOUD_TASKS_WORKER_SECRET: 'worker-secret-test',
  CLOUD_TASKS_INVOKER_SA: 'invoker@example.iam.gserviceaccount.com',
  CLOUD_TASKS_ENABLED: 'true',
  GOOGLE_CLOUD_PROJECT: 'auto-core-platform-test',
};

describe('NotificationCloudTasksService', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      ...Object.keys(QUEUE_ENV),
      'CLOUD_TASKS_QUEUE',
      'NODE_ENV',
    ]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    Object.assign(process.env, QUEUE_ENV);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('is enabled only with the notification queue and its worker settings', () => {
    const service = new NotificationCloudTasksService();
    expect(service.isEnabled()).toBe(true);

    delete process.env.CLOUD_TASKS_NOTIFICATION_QUEUE;
    expect(service.isEnabled()).toBe(false);
  });

  it('never falls back to the PDF queue', () => {
    const service = new NotificationCloudTasksService();
    delete process.env.CLOUD_TASKS_NOTIFICATION_QUEUE;
    process.env.CLOUD_TASKS_QUEUE = 'pdf-queue';

    expect(service.isEnabled()).toBe(false);
  });

  it('honours an explicit CLOUD_TASKS_ENABLED=false', () => {
    const service = new NotificationCloudTasksService();
    process.env.CLOUD_TASKS_ENABLED = 'false';

    expect(service.isEnabled()).toBe(false);
  });

  it('creates a signed wake-up on the notification queue, with the worker url and tenant header', async () => {
    const service = new NotificationCloudTasksService();
    const createTask = jest
      .spyOn(
        (service as unknown as { client: { createTask: jest.Mock } }).client,
        'createTask',
      )
      .mockResolvedValue([{ name: 'projects/p/locations/l/queues/q/tasks/t' }]);

    await service.enqueueWakeUp({
      outboxId: 'outbox-1',
      tenantId: 'tenant-1',
      delaySeconds: 60,
    });

    const { parent, task } = createTask.mock.calls[0][0] as {
      parent: string;
      task: {
        httpRequest: {
          url: string;
          headers: Record<string, string>;
          body: Buffer;
        };
        scheduleTime?: unknown;
      };
    };
    expect(parent).toContain('/queues/notification-queue');
    expect(parent).not.toContain('pdf-queue');
    expect(task.httpRequest.url).toBe(
      'https://worker.example/api/notifications/outbox/outbox-1/worker',
    );
    expect(task.httpRequest.headers).toMatchObject({
      'x-tenant-id': 'tenant-1',
      'x-cloud-tasks-secret': 'worker-secret-test',
    });
    expect(JSON.parse(task.httpRequest.body.toString())).toMatchObject({
      outboxId: 'outbox-1',
      tenantId: 'tenant-1',
      signature: expect.any(String),
    });
    expect(task.scheduleTime).toBeDefined();
  });

  it('refuses to enqueue while the queue is not configured', async () => {
    const service = new NotificationCloudTasksService();
    delete process.env.CLOUD_TASKS_NOTIFICATION_QUEUE;

    await expect(
      service.enqueueWakeUp({ outboxId: 'outbox-1', tenantId: 'tenant-1' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
