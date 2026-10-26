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
import { isCloudTasksEnabled } from '../common/services/cloud-tasks.config.js';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import type { ImportWorkerPhase } from './import-job.worker-state.js';
import { signImportTaskPayload } from './import-task.payload.js';
import { resolveImportWorkerTargetBaseUrl } from './import-worker-target.js';

@Injectable()
export class ImportCloudTasksService {
  private readonly logger = new Logger(ImportCloudTasksService.name);
  private readonly client: CloudTasksClient;
  private cachedProjectId?: string;

  constructor() {
    const { client, cachedProjectId } = initializeCloudTasksClient(this.logger);
    this.client = client;
    this.cachedProjectId = cachedProjectId;
  }

  isEnabled(): boolean {
    return isCloudTasksEnabled();
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

  private resolveTargetBaseUrl(): string {
    const raw = resolveImportWorkerTargetBaseUrl();
    if (!raw) {
      throw new InternalServerErrorException(
        'Import worker target base URL is not configured',
      );
    }
    return raw.endsWith('/') ? raw : `${raw}/`;
  }

  async enqueueImportWorker(params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
    delaySeconds?: number;
  }): Promise<void> {
    SideEffectGuard.assertAllowed('QUEUE_ENQUEUE');
    if (!this.isEnabled()) {
      throw new InternalServerErrorException('Cloud Tasks is not enabled');
    }
    const workerSecret = process.env.CLOUD_TASKS_WORKER_SECRET as string;
    const invokerServiceAccount = process.env.CLOUD_TASKS_INVOKER_SA as string;
    const location = process.env.CLOUD_TASKS_LOCATION as string;
    const queue = process.env.CLOUD_TASKS_QUEUE as string;
    const targetBaseUrl = this.resolveTargetBaseUrl();
    const url = new URL(
      `imports/${params.jobId}/worker`,
      targetBaseUrl,
    ).toString();
    const projectId = await this.getProjectId();
    const payload = signImportTaskPayload(
      {
        tenantId: params.tenantId,
        jobId: params.jobId,
        phase: params.phase,
      },
      workerSecret,
    );
    const task = buildTaskRequest({
      url,
      workerSecret,
      tenantId: params.tenantId,
      payload,
      invokerServiceAccount,
      targetBaseUrl,
      delaySeconds: params.delaySeconds,
    });
    await this.client.createTask({
      parent: this.client.queuePath(projectId, location, queue),
      task,
    });
    this.logger.log(
      `Enqueued import ${params.phase} worker for job ${params.jobId}`,
    );
  }
}
