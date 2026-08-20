import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import * as Sentry from '@sentry/node';
import { type PdfTaskKind, signPdfTaskPayload } from '../pdf/pdf-task-payload';

const PDF_WORKER_PATH: Record<PdfTaskKind, (resourceId: string) => string> = {
  invoice: (resourceId) => `invoices/${resourceId}/pdf/worker`,
  'workshop-order': (resourceId) => `workshop/orders/${resourceId}/pdf/worker`,
};

export function resolveCloudTasksOidcAudience(targetBaseUrl: string): string {
  const normalized = targetBaseUrl.endsWith('/')
    ? targetBaseUrl
    : `${targetBaseUrl}/`;
  return new URL(normalized).origin;
}

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

  async enqueuePdfGeneration(params: {
    kind: PdfTaskKind;
    resourceId: string;
    targetBaseUrl: string;
    delaySeconds?: number;
    tenantId: string;
  }): Promise<{ taskId: string }> {
    return Sentry.startSpan(
      { name: 'Enqueue PDF generation task', op: 'cloudtasks.enqueue' },
      async (span) => {
        const { kind, resourceId, tenantId } = params;
        span.setAttribute('pdfKind', kind);
        span.setAttribute('resourceId', resourceId);

        if (!this.isEnabled()) {
          throw new InternalServerErrorException(
            'Cloud Tasks is not enabled or not configured',
          );
        }

        const workerSecret = process.env.CLOUD_TASKS_WORKER_SECRET;
        const location = process.env.CLOUD_TASKS_LOCATION;
        const queue = process.env.CLOUD_TASKS_QUEUE;
        const invokerServiceAccount = process.env.CLOUD_TASKS_INVOKER_SA;

        if (!workerSecret || !location || !queue || !invokerServiceAccount) {
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

          url = new URL(PDF_WORKER_PATH[kind](resourceId), baseUrl).toString();
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

        const payload = signPdfTaskPayload(
          { kind, resourceId, tenantId },
          workerSecret,
        );

        const oidcAudience = resolveCloudTasksOidcAudience(params.targetBaseUrl);

        const [task] = await this.client.createTask({
          parent,
          task: {
            httpRequest: {
              httpMethod: 'POST',
              url,
              headers: {
                'Content-Type': 'application/json',
                'x-cloud-tasks-secret': workerSecret,
                'x-tenant-id': tenantId,
              },
              body: Buffer.from(JSON.stringify(payload)),
              oidcToken: {
                serviceAccountEmail: invokerServiceAccount,
                audience: oidcAudience,
              },
            },
            scheduleTime,
            dispatchDeadline: { seconds: 600 },
          },
        });

        const fullTaskName = task.name;
        if (!fullTaskName) {
          this.logger.error(
            `Cloud Tasks createTask() returned a task without a name for ${kind} ${resourceId}`,
          );
          throw new InternalServerErrorException(
            'Cloud Tasks returned a malformed task without a name',
          );
        }

        const taskId = fullTaskName.split('/').pop() || fullTaskName;

        this.logger.log(
          `Enqueued Cloud Task for ${kind} ${resourceId} (${taskId})`,
        );

        return { taskId };
      },
    );
  }
}
