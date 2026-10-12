import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { CloudTasksClient } from '@google-cloud/tasks';
import {
  buildTaskRequest,
  initializeCloudTasksClient,
} from '../common/services/cloud-tasks.service.js';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import { signNotificationTaskPayload } from './notification-task.payload.js';

/**
 * Wake-up tasks for the notification outbox (ADR-0025 §6). They go to CLOUD_TASKS_NOTIFICATION_QUEUE,
 * never to the PDF queue. The outbox row is the record; a task only prompts the worker. Task names are
 * left to Cloud Tasks, because a deterministic name stays reserved after its task has run.
 */
@Injectable()
export class NotificationCloudTasksService {
  private readonly logger = new Logger(NotificationCloudTasksService.name);
  private readonly client: CloudTasksClient;
  private cachedProjectId?: string;

  constructor() {
    const { client, cachedProjectId } = initializeCloudTasksClient(this.logger);
    this.client = client;
    this.cachedProjectId = cachedProjectId;
  }

  /**
   * The PDF queue's switch (CloudTasksService.isEnabled), applied to the notification queue. The target
   * is its own variable: a wake-up must reach a service that holds the NOTIFICATION_* settings, and the
   * PDF worker never does.
   */
  isEnabled(): boolean {
    const configured =
      Boolean(process.env.CLOUD_TASKS_NOTIFICATION_QUEUE) &&
      Boolean(process.env.CLOUD_TASKS_LOCATION) &&
      Boolean(process.env.CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL) &&
      Boolean(process.env.CLOUD_TASKS_WORKER_SECRET) &&
      Boolean(process.env.CLOUD_TASKS_INVOKER_SA);
    if (!configured) {
      return false;
    }
    const flag = process.env.CLOUD_TASKS_ENABLED;
    if (flag === 'true') return true;
    if (flag === 'false') return false;
    return process.env.NODE_ENV === 'production';
  }

  async enqueueWakeUp(params: {
    outboxId: string;
    tenantId: string;
    delaySeconds?: number;
  }): Promise<void> {
    SideEffectGuard.assertAllowed('QUEUE_ENQUEUE');
    if (!this.isEnabled()) {
      throw new InternalServerErrorException(
        'Notification queue is not enabled or not configured',
      );
    }
    const workerSecret = process.env.CLOUD_TASKS_WORKER_SECRET as string;
    const invokerServiceAccount = process.env.CLOUD_TASKS_INVOKER_SA as string;
    const location = process.env.CLOUD_TASKS_LOCATION as string;
    const queue = process.env.CLOUD_TASKS_NOTIFICATION_QUEUE as string;
    const targetBaseUrl = process.env
      .CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL as string;
    const baseUrl = targetBaseUrl.endsWith('/')
      ? targetBaseUrl
      : `${targetBaseUrl}/`;
    const url = new URL(
      `notifications/outbox/${params.outboxId}/worker`,
      baseUrl,
    ).toString();
    const projectId = await this.getProjectId();
    const task = buildTaskRequest({
      url,
      workerSecret,
      tenantId: params.tenantId,
      payload: signNotificationTaskPayload(
        { outboxId: params.outboxId, tenantId: params.tenantId },
        workerSecret,
      ),
      invokerServiceAccount,
      targetBaseUrl,
      delaySeconds: params.delaySeconds,
      dispatchDeadlineSeconds: 600,
    });
    await this.client.createTask({
      parent: this.client.queuePath(projectId, location, queue),
      task,
    });
    this.logger.log(
      `Enqueued notification wake-up for outbox ${params.outboxId}`,
    );
  }

  private async getProjectId(): Promise<string> {
    if (process.env.GOOGLE_CLOUD_PROJECT) {
      return process.env.GOOGLE_CLOUD_PROJECT;
    }
    if (this.cachedProjectId) {
      return this.cachedProjectId;
    }
    this.cachedProjectId = String(await this.client.getProjectId());
    return this.cachedProjectId;
  }
}
