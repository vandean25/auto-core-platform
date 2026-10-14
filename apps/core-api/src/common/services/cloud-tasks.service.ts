import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { CloudTasksClient } from '@google-cloud/tasks';
import * as Sentry from '@sentry/node';
import {
  type PdfTaskKind,
  signPdfTaskPayload,
} from '../pdf/pdf-task-payload.js';
import { signDocumentBrandingExtractionTask } from '../../document-branding/document-branding-extraction-task.js';
import { SideEffectGuard } from '../../dry-run/side-effect-guard.js';
import {
  CLOUD_TASKS_NOT_ENABLED_MESSAGE,
  getRequiredCloudTasksEnv,
  isCloudTasksEnabled,
  type RequiredCloudTasksEnv,
} from './cloud-tasks.config.js';
import { initializeCloudTasksClient } from './cloud-tasks.client.js';
import {
  buildDocumentBrandingTaskUrl,
  buildPdfTaskUrl,
} from './cloud-tasks.urls.js';
import { buildTaskRequest } from './cloud-tasks.request.js';
import {
  buildDocumentBrandingAssetValidationRequest,
  createDocumentBrandingExtractionTask,
} from './cloud-tasks.document-branding.js';
import {
  deterministicExtractionTaskId,
  taskIdFromName,
} from './cloud-tasks.task-identity.js';

// Re-exported so existing importers keep using this module.
export {
  resolveCloudTasksOidcAudience,
  buildPdfTaskUrl,
} from './cloud-tasks.urls.js';
export {
  getRequiredCloudTasksEnv,
  type RequiredCloudTasksEnv,
} from './cloud-tasks.config.js';
export { initializeCloudTasksClient } from './cloud-tasks.client.js';
export {
  buildTaskRequest,
  type BuildTaskRequestParams,
} from './cloud-tasks.request.js';

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
    return isCloudTasksEnabled();
  }

  private requireEnabledEnv(): RequiredCloudTasksEnv {
    if (!this.isEnabled()) {
      throw new InternalServerErrorException(CLOUD_TASKS_NOT_ENABLED_MESSAGE);
    }
    return getRequiredCloudTasksEnv();
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
    return taskIdFromName(taskName);
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

        const env = this.requireEnabledEnv();
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
    traceId?: string;
  }): Promise<{ taskId: string }> {
    SideEffectGuard.assertAllowed('QUEUE_ENQUEUE');
    const env = this.requireEnabledEnv();
    const projectId = await this.getProjectId();
    const url = buildDocumentBrandingTaskUrl(
      params.targetBaseUrl,
      `document-branding/assets/${params.assetId}/worker`,
    );
    const [task] = await this.client.createTask({
      parent: this.client.queuePath(projectId, env.location, env.queue),
      task: buildDocumentBrandingAssetValidationRequest(
        {
          url,
          assetId: params.assetId,
          tenantId: params.tenantId,
          targetBaseUrl: params.targetBaseUrl,
          traceId: params.traceId,
        },
        env,
      ),
    });
    if (!task.name) {
      throw new InternalServerErrorException(
        'Cloud Tasks returned a malformed task without a name',
      );
    }
    return { taskId: taskIdFromName(task.name) };
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
    const env = this.requireEnabledEnv();
    const projectId = await this.getProjectId();
    const url = buildDocumentBrandingTaskUrl(
      params.targetBaseUrl,
      `legal-entities/${params.legalEntityId}/document-branding/extractions/${params.extractionId}/worker`,
    );
    const parent = this.client.queuePath(projectId, env.location, env.queue);
    const task = buildTaskRequest({
      url,
      workerSecret: env.workerSecret,
      tenantId: params.tenantId,
      payload: signDocumentBrandingExtractionTask(
        {
          extractionId: params.extractionId,
          legalEntityId: params.legalEntityId,
          tenantId: params.tenantId,
          expectedAttemptCount: params.expectedAttemptCount,
        },
        env.workerSecret,
      ),
      invokerServiceAccount: env.invokerServiceAccount,
      targetBaseUrl: params.targetBaseUrl,
      delaySeconds: params.delaySeconds,
      dispatchDeadlineSeconds: 60,
    });
    const acceptedTaskName = await createDocumentBrandingExtractionTask(
      this.client,
      {
        parent,
        taskId: deterministicExtractionTaskId(
          params.extractionId,
          params.expectedAttemptCount,
        ),
        task,
        taskPath: (taskId) =>
          this.client.taskPath(projectId, env.location, env.queue, taskId),
      },
    );
    if (!acceptedTaskName) {
      throw new InternalServerErrorException(
        'Cloud Tasks returned a malformed task without a name',
      );
    }
    return { taskId: taskIdFromName(acceptedTaskName) };
  }
}
