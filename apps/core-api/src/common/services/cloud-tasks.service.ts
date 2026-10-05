import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { createHash, randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import {
  type PdfTaskKind,
  signPdfTaskPayload,
} from '../pdf/pdf-task-payload.js';
import { signDocumentBrandingUploadTask } from '../../document-branding/document-branding-upload-task.js';
import { signDocumentBrandingExtractionTask } from '../../document-branding/document-branding-extraction-task.js';
import { SideEffectGuard } from '../../dry-run/side-effect-guard.js';

const PDF_WORKER_PATH: Record<PdfTaskKind, (resourceId: string) => string> = {
  invoice: (resourceId) => `invoices/${resourceId}/pdf/worker`,
  'workshop-order': (resourceId) => `workshop/orders/${resourceId}/pdf/worker`,
  'credit-note': (resourceId) => `credit-notes/${resourceId}/pdf/worker`,
};

export function resolveCloudTasksOidcAudience(targetBaseUrl: string): string {
  const normalized = targetBaseUrl.endsWith('/')
    ? targetBaseUrl
    : `${targetBaseUrl}/`;
  return new URL(normalized).origin;
}

export function buildPdfTaskUrl(
  targetBaseUrl: string,
  kind: PdfTaskKind,
  resourceId: string,
): string {
  try {
    const baseUrl = targetBaseUrl.endsWith('/')
      ? targetBaseUrl
      : `${targetBaseUrl}/`;
    return new URL(PDF_WORKER_PATH[kind](resourceId), baseUrl).toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InternalServerErrorException(
      `Invalid Cloud Tasks target base URL: ${message}`,
    );
  }
}

export interface RequiredCloudTasksEnv {
  workerSecret: string;
  location: string;
  queue: string;
  invokerServiceAccount: string;
}

export function getRequiredCloudTasksEnv(): RequiredCloudTasksEnv {
  const workerSecret = process.env.CLOUD_TASKS_WORKER_SECRET;
  const location = process.env.CLOUD_TASKS_LOCATION;
  const queue = process.env.CLOUD_TASKS_QUEUE;
  const invokerServiceAccount = process.env.CLOUD_TASKS_INVOKER_SA;

  if (!workerSecret) {
    throw new InternalServerErrorException(
      'Cloud Tasks is missing required configuration environment variables',
    );
  }
  if (!location) {
    throw new InternalServerErrorException(
      'Cloud Tasks is missing required configuration environment variables',
    );
  }
  if (!queue) {
    throw new InternalServerErrorException(
      'Cloud Tasks is missing required configuration environment variables',
    );
  }
  if (!invokerServiceAccount) {
    throw new InternalServerErrorException(
      'Cloud Tasks is missing required configuration environment variables',
    );
  }

  return { workerSecret, location, queue, invokerServiceAccount };
}

interface ParsedGcpCredentials {
  clientEmail: string;
  privateKey: string;
  projectId?: string;
}

function parseGcpCredentials(raw: string): ParsedGcpCredentials {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const clientEmail =
    typeof parsed.client_email === 'string' ? parsed.client_email : undefined;
  const privateKey =
    typeof parsed.private_key === 'string' ? parsed.private_key : undefined;
  const projectId =
    typeof parsed.project_id === 'string' ? parsed.project_id : undefined;

  if (!clientEmail || !privateKey) {
    throw new Error(
      'GCP_CREDENTIALS does not include client_email/private_key fields',
    );
  }

  return { clientEmail, privateKey, projectId };
}

function formatErrorMessage(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

function createClientFromCredentials(rawCredentials: string): {
  client: CloudTasksClient;
  cachedProjectId?: string;
} {
  const { clientEmail, privateKey, projectId } =
    parseGcpCredentials(rawCredentials);
  const client = new CloudTasksClient({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });
  return { client, cachedProjectId: projectId };
}

export function initializeCloudTasksClient(logger: Logger): {
  client: CloudTasksClient;
  cachedProjectId?: string;
} {
  const credentials = process.env.GCP_CREDENTIALS;
  if (!credentials) {
    return { client: new CloudTasksClient() };
  }

  try {
    const result = createClientFromCredentials(credentials);
    logger.log('Cloud Tasks client initialized with GCP_CREDENTIALS from env');
    return result;
  } catch (error) {
    const { message, stack } = formatErrorMessage(error);
    logger.error(
      `Failed to parse GCP_CREDENTIALS for Cloud Tasks client; falling back to default credentials: ${message}`,
      stack,
    );
    return { client: new CloudTasksClient() };
  }
}

function calculateScheduleTime(
  delaySeconds?: number,
): { seconds: number } | undefined {
  const delay = Math.max(0, Math.floor(delaySeconds ?? 0));
  if (delay <= 0) {
    return undefined;
  }
  return { seconds: Math.floor(Date.now() / 1000) + delay };
}

interface BuildTaskRequestParams {
  url: string;
  workerSecret: string;
  tenantId: string;
  payload: unknown;
  invokerServiceAccount: string;
  targetBaseUrl: string;
  delaySeconds?: number;
  dispatchDeadlineSeconds?: number;
}

function buildTaskRequest(params: BuildTaskRequestParams) {
  return {
    httpRequest: {
      httpMethod: 'POST' as const,
      url: params.url,
      headers: {
        'Content-Type': 'application/json',
        'x-cloud-tasks-secret': params.workerSecret,
        'x-tenant-id': params.tenantId,
      },
      body: Buffer.from(JSON.stringify(params.payload)),
      oidcToken: {
        serviceAccountEmail: params.invokerServiceAccount,
        audience: resolveCloudTasksOidcAudience(params.targetBaseUrl),
      },
    },
    scheduleTime: calculateScheduleTime(params.delaySeconds),
    dispatchDeadline: { seconds: params.dispatchDeadlineSeconds ?? 600 },
  };
}

@Injectable()
export class CloudTasksService {
  private readonly logger = new Logger(CloudTasksService.name);
  private readonly client: CloudTasksClient;
  private cachedProjectId?: string;

  constructor() {
    const { client, cachedProjectId } = initializeCloudTasksClient(this.logger);
    this.client = client;
    this.cachedProjectId = cachedProjectId;
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

  private resolveTaskId(
    taskName: string | null | undefined,
    kind: PdfTaskKind,
    resourceId: string,
  ): string {
    if (!taskName) {
      this.logger.error(
        `Cloud Tasks createTask() returned a task without a name for ${kind} ${resourceId}`,
      );
      throw new InternalServerErrorException(
        'Cloud Tasks returned a malformed task without a name',
      );
    }
    return taskName.split('/').pop() || taskName;
  }

  async enqueuePdfGeneration(params: {
    kind: PdfTaskKind;
    resourceId: string;
    targetBaseUrl: string;
    delaySeconds?: number;
    tenantId: string;
  }): Promise<{ taskId: string }> {
    SideEffectGuard.assertAllowed('QUEUE_ENQUEUE');
    return Sentry.startSpan(
      { name: 'Enqueue PDF generation task', op: 'cloudtasks.enqueue' },
      async (span) => {
        const { kind, resourceId, tenantId, targetBaseUrl, delaySeconds } =
          params;
        span.setAttribute('pdfKind', kind);
        span.setAttribute('resourceId', resourceId);

        if (!this.isEnabled()) {
          throw new InternalServerErrorException(
            'Cloud Tasks is not enabled or not configured',
          );
        }

        const env = getRequiredCloudTasksEnv();
        const projectId = await this.getProjectId();
        const parent = this.client.queuePath(
          projectId,
          env.location,
          env.queue,
        );
        const url = buildPdfTaskUrl(targetBaseUrl, kind, resourceId);

        span.setAttribute('queue', env.queue);
        span.setAttribute('location', env.location);
        span.setAttribute('targetUrl', url);

        const payload = signPdfTaskPayload(
          { kind, resourceId, tenantId },
          env.workerSecret,
        );

        const task = buildTaskRequest({
          url,
          workerSecret: env.workerSecret,
          tenantId,
          payload,
          invokerServiceAccount: env.invokerServiceAccount,
          targetBaseUrl,
          delaySeconds,
        });

        const [createdTask] = await this.client.createTask({ parent, task });
        const taskId = this.resolveTaskId(createdTask.name, kind, resourceId);
        this.logger.log(
          `Enqueued Cloud Task for ${kind} ${resourceId} (${taskId})`,
        );

        return { taskId };
      },
    );
  }

  async enqueueDocumentBrandingAssetValidation(params: {
    assetId: string;
    tenantId: string;
    targetBaseUrl: string;
  }): Promise<{ taskId: string }> {
    SideEffectGuard.assertAllowed('QUEUE_ENQUEUE');
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
    let url: string;
    try {
      const baseUrl = params.targetBaseUrl.endsWith('/')
        ? params.targetBaseUrl
        : `${params.targetBaseUrl}/`;
      url = new URL(
        `document-branding/assets/${params.assetId}/worker`,
        baseUrl,
      ).toString();
    } catch {
      throw new InternalServerErrorException(
        'Invalid Cloud Tasks target base URL',
      );
    }
    const [task] = await this.client.createTask({
      parent: this.client.queuePath(projectId, location, queue),
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url,
          headers: {
            'Content-Type': 'application/json',
            'x-cloud-tasks-secret': workerSecret,
            'x-tenant-id': params.tenantId,
          },
          body: Buffer.from(
            JSON.stringify(
              signDocumentBrandingUploadTask(
                { assetId: params.assetId, tenantId: params.tenantId },
                workerSecret,
              ),
            ),
          ),
          oidcToken: {
            serviceAccountEmail: invokerServiceAccount,
            audience: resolveCloudTasksOidcAudience(params.targetBaseUrl),
          },
        },
        dispatchDeadline: { seconds: 600 },
      },
    });
    if (!task.name) {
      throw new InternalServerErrorException(
        'Cloud Tasks returned a malformed task without a name',
      );
    }
    return { taskId: task.name.split('/').pop() || task.name };
  }

  async enqueueDocumentBrandingExtraction(params: {
    extractionId: string;
    legalEntityId: string;
    tenantId: string;
    expectedAttemptCount: number;
    targetBaseUrl: string;
    delaySeconds?: number;
  }): Promise<{ taskId: string }> {
    SideEffectGuard.assertAllowed('QUEUE_ENQUEUE');
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
    let url: string;
    try {
      const baseUrl = params.targetBaseUrl.endsWith('/')
        ? params.targetBaseUrl
        : `${params.targetBaseUrl}/`;
      url = new URL(
        `legal-entities/${params.legalEntityId}/document-branding/extractions/${params.extractionId}/worker`,
        baseUrl,
      ).toString();
    } catch {
      throw new InternalServerErrorException(
        'Invalid Cloud Tasks target base URL',
      );
    }
    const parent = this.client.queuePath(projectId, location, queue);
    const task = buildTaskRequest({
      url,
      workerSecret,
      tenantId: params.tenantId,
      payload: signDocumentBrandingExtractionTask(
        {
          extractionId: params.extractionId,
          legalEntityId: params.legalEntityId,
          tenantId: params.tenantId,
          expectedAttemptCount: params.expectedAttemptCount,
        },
        workerSecret,
      ),
      invokerServiceAccount,
      targetBaseUrl: params.targetBaseUrl,
      delaySeconds: params.delaySeconds,
      dispatchDeadlineSeconds: 60,
    });
    const taskId = deterministicExtractionTaskId(
      params.extractionId,
      params.expectedAttemptCount,
    );
    const name = this.client.taskPath(projectId, location, queue, taskId);
    let acceptedTaskName: string | null | undefined;
    try {
      const [acceptedTask] = await this.client.createTask({
        parent,
        task: { ...task, name },
      });
      acceptedTaskName = acceptedTask.name;
    } catch (error) {
      if (cloudTasksErrorCode(error) !== 6) throw error;
      try {
        const [activeTask] = await this.client.getTask({ name });
        acceptedTaskName = activeTask.name;
      } catch (lookupError) {
        if (cloudTasksErrorCode(lookupError) !== 5) throw lookupError;
        const freshName = this.client.taskPath(
          projectId,
          location,
          queue,
          `document-branding-extraction-${randomUUID()}`,
        );
        const [acceptedTask] = await this.client.createTask({
          parent,
          task: { ...task, name: freshName },
        });
        acceptedTaskName = acceptedTask.name;
      }
    }
    if (!acceptedTaskName) {
      throw new InternalServerErrorException(
        'Cloud Tasks returned a malformed task without a name',
      );
    }
    return {
      taskId: acceptedTaskName.split('/').pop() || acceptedTaskName,
    };
  }
}

function deterministicExtractionTaskId(
  extractionId: string,
  expectedAttemptCount: number,
): string {
  const digest = createHash('sha256')
    .update(`${extractionId}:${expectedAttemptCount}`)
    .digest('hex');
  return `document-branding-extraction-${digest.slice(0, 40)}`;
}

function cloudTasksErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'number' ? error.code : null;
}
