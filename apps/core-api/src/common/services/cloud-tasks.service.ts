import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import * as Sentry from '@sentry/node';

@Injectable()
export class CloudTasksService {
  private readonly logger = new Logger(CloudTasksService.name);
  private readonly client: CloudTasksClient;
  private cachedProjectId?: string;

  constructor() {
    const credentials = process.env.GCP_CREDENTIALS;
    if (credentials) {
      try {
        const parsed = JSON.parse(credentials) as Record<string, unknown>;

        const clientEmail =
          typeof parsed.client_email === 'string'
            ? parsed.client_email
            : undefined;
        const privateKey =
          typeof parsed.private_key === 'string'
            ? parsed.private_key
            : undefined;

        const projectId =
          typeof parsed.project_id === 'string' ? parsed.project_id : undefined;

        if (!clientEmail || !privateKey) {
          throw new Error(
            'GCP_CREDENTIALS does not include client_email/private_key fields',
          );
        }

        this.cachedProjectId = projectId;

        this.client = new CloudTasksClient({
          projectId,
          credentials: {
            client_email: clientEmail,
            private_key: privateKey,
          },
        });
        this.logger.log(
          'Cloud Tasks client initialized with GCP_CREDENTIALS from env',
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        this.logger.error(
          `Failed to parse GCP_CREDENTIALS for Cloud Tasks client; falling back to default credentials: ${message}`,
          stack,
        );
      }
    }

    this.client = new CloudTasksClient();
  }

  private async getProjectId(): Promise<string> {
    if (process.env.GOOGLE_CLOUD_PROJECT)
      return process.env.GOOGLE_CLOUD_PROJECT;
    if (this.cachedProjectId) return this.cachedProjectId;

    this.cachedProjectId = String(await this.client.getProjectId());
    return this.cachedProjectId;
  }

  isEnabled(): boolean {
    const configured =
      Boolean(process.env.CLOUD_TASKS_LOCATION) &&
      Boolean(process.env.CLOUD_TASKS_QUEUE) &&
      Boolean(process.env.CLOUD_TASKS_WORKER_SECRET);
    if (!configured) {
      return false;
    }

    const flag = process.env.CLOUD_TASKS_ENABLED;
    if (flag === 'true') return true;
    if (flag === 'false') return false;

    return process.env.NODE_ENV === 'production';
  }

  async enqueuePdfGeneration(params: {
    invoiceId: string;
    targetBaseUrl: string;
    delaySeconds?: number;
    tenantId: string;
  }): Promise<{ taskId: string }> {
    return Sentry.startSpan(
      { name: 'Enqueue PDF generation task', op: 'cloudtasks.enqueue' },
      async (span) => {
        const { invoiceId } = params;
        span.setAttribute('invoiceId', invoiceId);

        if (!this.isEnabled()) {
          throw new InternalServerErrorException(
            'Cloud Tasks is not enabled or not configured',
          );
        }

        const workerSecret = process.env.CLOUD_TASKS_WORKER_SECRET;
        const location = process.env.CLOUD_TASKS_LOCATION;
        const queue = process.env.CLOUD_TASKS_QUEUE;

        if (!workerSecret || !location || !queue) {
          throw new InternalServerErrorException(
            'Cloud Tasks is missing required configuration environment variables',
          );
        }

        const projectId = await this.getProjectId();
        const parent = this.client.queuePath(projectId, location, queue);

        let url: string;
        try {
          const baseUrl = params.targetBaseUrl.endsWith('/')
            ? params.targetBaseUrl
            : `${params.targetBaseUrl}/`;

          url = new URL(`invoices/${invoiceId}/pdf/worker`, baseUrl).toString();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new InternalServerErrorException(
            `Invalid Cloud Tasks target base URL: ${message}`,
          );
        }

        span.setAttribute('queue', queue);
        span.setAttribute('location', location);
        span.setAttribute('targetUrl', url);

        const delaySeconds = Math.max(0, Math.floor(params.delaySeconds ?? 0));
        const scheduleTime =
          delaySeconds > 0
            ? { seconds: Math.floor(Date.now() / 1000) + delaySeconds }
            : undefined;

        const [task] = await this.client.createTask({
          parent,
          task: {
            httpRequest: {
              httpMethod: 'POST',
              url,
              headers: {
                'Content-Type': 'application/json',
                'x-cloud-tasks-secret': workerSecret,
                'x-tenant-id': params.tenantId,
              },
              body: Buffer.from('{}'),
            },
            scheduleTime,
            dispatchDeadline: { seconds: 600 },
          },
        });

        const fullTaskName = task.name;
        if (!fullTaskName) {
          this.logger.error(
            `Cloud Tasks createTask() returned a task without a name for invoice ${invoiceId}`,
          );
          throw new InternalServerErrorException(
            'Cloud Tasks returned a malformed task without a name',
          );
        }

        // Extract base ID to avoid leaking full resource path to clients
        const taskId = fullTaskName.split('/').pop() || fullTaskName;

        this.logger.log(
          `Enqueued Cloud Task for invoice ${invoiceId} (${taskId})`,
        );

        return { taskId };
      },
    );
  }

  async enqueueWorkshopPdfGeneration(params: {
    workshopOrderId: string;
    targetBaseUrl: string;
    delaySeconds?: number;
    tenantId: string;
  }): Promise<{ taskId: string }> {
    return Sentry.startSpan(
      { name: 'Enqueue Workshop PDF task', op: 'cloudtasks.enqueue' },
      async (span) => {
        const { workshopOrderId } = params;
        span.setAttribute('workshopOrderId', workshopOrderId);

        if (!this.isEnabled()) {
          throw new InternalServerErrorException(
            'Cloud Tasks is not enabled or not configured',
          );
        }

        const workerSecret = process.env.CLOUD_TASKS_WORKER_SECRET;
        const location = process.env.CLOUD_TASKS_LOCATION;
        const queue = process.env.CLOUD_TASKS_QUEUE;

        if (!workerSecret || !location || !queue) {
          throw new InternalServerErrorException(
            'Cloud Tasks is missing required config variables',
          );
        }

        const projectId = await this.getProjectId();
        const parent = this.client.queuePath(projectId, location, queue);

        let url: string;
        try {
          const baseUrl = params.targetBaseUrl.endsWith('/')
            ? params.targetBaseUrl
            : `${params.targetBaseUrl}/`;

          url = new URL(
            `workshop/orders/${workshopOrderId}/pdf/worker`,
            baseUrl,
          ).toString();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new InternalServerErrorException(
            `Invalid Cloud Tasks target base URL: ${message}`,
          );
        }

        span.setAttribute('queue', queue);
        span.setAttribute('location', location);
        span.setAttribute('targetUrl', url);

        const delaySeconds = Math.max(0, Math.floor(params.delaySeconds ?? 0));
        const scheduleTime =
          delaySeconds > 0
            ? { seconds: Math.floor(Date.now() / 1000) + delaySeconds }
            : undefined;

        const [task] = await this.client.createTask({
          parent,
          task: {
            httpRequest: {
              httpMethod: 'POST',
              url,
              headers: {
                'Content-Type': 'application/json',
                'x-cloud-tasks-secret': workerSecret,
                'x-tenant-id': params.tenantId,
              },
              body: Buffer.from('{}'),
            },
            scheduleTime,
            dispatchDeadline: { seconds: 600 },
          },
        });

        const fullTaskName = task.name;
        if (!fullTaskName) {
          throw new InternalServerErrorException(
            'Cloud Tasks returned a task without a name',
          );
        }

        const taskId = fullTaskName.split('/').pop() || fullTaskName;
        this.logger.log(
          `Enqueued Cloud Task for workshop order ${workshopOrderId} (${taskId})`,
        );

        return { taskId };
      },
    );
  }
}
