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
import { signDomainEventConsumerTaskPayload } from './domain-event-consumer-task.payload.js';

@Injectable()
export class DomainEventConsumerCloudTasksService {
  private readonly logger = new Logger(DomainEventConsumerCloudTasksService.name);
  private readonly client: CloudTasksClient;
  private cachedProjectId?: string;

  constructor() {
    const { client, cachedProjectId } = initializeCloudTasksClient(this.logger);
    this.client = client;
    this.cachedProjectId = cachedProjectId;
  }

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
    tenantId: string;
    consumerKey: string;
    delaySeconds?: number;
  }): Promise<void> {
    SideEffectGuard.assertAllowed('QUEUE_ENQUEUE');
    if (!this.isEnabled()) {
      throw new InternalServerErrorException(
        'Domain event consumer queue is not enabled or not configured',
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
      `domain-event-consumers/${encodeURIComponent(params.consumerKey)}/worker`,
      baseUrl,
    ).toString();
    const projectId = await this.getProjectId();
    const task = buildTaskRequest({
      url,
      workerSecret,
      tenantId: params.tenantId,
      payload: signDomainEventConsumerTaskPayload(
        { tenantId: params.tenantId, consumerKey: params.consumerKey },
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
      `Enqueued domain event consumer wake-up for ${params.consumerKey} (tenant ${params.tenantId})`,
    );
  }

  private async getProjectId(): Promise<string> {
    if (process.env.GOOGLE_CLOUD_PROJECT) {
      return process.env.GOOGLE_CLOUD_PROJECT;
    }
    if (this.cachedProjectId) {
      return this.cachedProjectId;
    }
    const [projectId] = await this.client.getProjectId();
    this.cachedProjectId = projectId;
    return projectId;
  }
}
