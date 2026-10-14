import { randomUUID } from 'node:crypto';
import type { CloudTasksClient, protos } from '@google-cloud/tasks';
import { signDocumentBrandingUploadTask } from '../../document-branding/document-branding-upload-task.js';
import { getSentryTraceHeaders } from '../observability/trace.js';
import type { RequiredCloudTasksEnv } from './cloud-tasks.config.js';
import { cloudTasksErrorCode } from './cloud-tasks.task-identity.js';
import { resolveCloudTasksOidcAudience } from './cloud-tasks.urls.js';

type CloudTasksTask = protos.google.cloud.tasks.v2.ITask;

export type CloudTasksTaskClient = Pick<
  CloudTasksClient,
  'createTask' | 'getTask' | 'taskPath'
>;

export interface DocumentBrandingAssetValidationRequestParams {
  url: string;
  assetId: string;
  tenantId: string;
  targetBaseUrl: string;
  traceId?: string;
}

export function buildDocumentBrandingAssetValidationRequest(
  params: DocumentBrandingAssetValidationRequestParams,
  env: Pick<RequiredCloudTasksEnv, 'workerSecret' | 'invokerServiceAccount'>,
): CloudTasksTask {
  return {
    httpRequest: {
      httpMethod: 'POST',
      url: params.url,
      headers: {
        'Content-Type': 'application/json',
        'x-cloud-tasks-secret': env.workerSecret,
        'x-tenant-id': params.tenantId,
        // Carries the upload's trace id into the validation worker's request.
        ...(params.traceId ? { 'x-trace-id': params.traceId } : {}),
        ...getSentryTraceHeaders(),
      },
      body: Buffer.from(
        JSON.stringify(
          signDocumentBrandingUploadTask(
            { assetId: params.assetId, tenantId: params.tenantId },
            env.workerSecret,
          ),
        ),
      ),
      oidcToken: {
        serviceAccountEmail: env.invokerServiceAccount,
        audience: resolveCloudTasksOidcAudience(params.targetBaseUrl),
      },
    },
    dispatchDeadline: { seconds: 600 },
  };
}

export interface DocumentBrandingExtractionTaskRequest {
  parent: string;
  taskId: string;
  task: CloudTasksTask;
  taskPath: (taskId: string) => string;
}

/**
 * Creates the extraction task under its deterministic name. When that name
 * already exists, the active task is reused; when it is a deleted tombstone,
 * a task with a fresh random name is created instead.
 */
export async function createDocumentBrandingExtractionTask(
  client: CloudTasksTaskClient,
  request: DocumentBrandingExtractionTaskRequest,
): Promise<string | null | undefined> {
  const name = request.taskPath(request.taskId);
  try {
    const [acceptedTask] = await client.createTask({
      parent: request.parent,
      task: { ...request.task, name },
    });
    return acceptedTask.name;
  } catch (error) {
    if (cloudTasksErrorCode(error) !== 6) throw error;
    return reuseOrRecreateExtractionTask(client, request, name);
  }
}

async function reuseOrRecreateExtractionTask(
  client: CloudTasksTaskClient,
  request: DocumentBrandingExtractionTaskRequest,
  name: string,
): Promise<string | null | undefined> {
  try {
    const [activeTask] = await client.getTask({ name });
    return activeTask.name;
  } catch (lookupError) {
    if (cloudTasksErrorCode(lookupError) !== 5) throw lookupError;
    const freshName = request.taskPath(
      `document-branding-extraction-${randomUUID()}`,
    );
    const [acceptedTask] = await client.createTask({
      parent: request.parent,
      task: { ...request.task, name: freshName },
    });
    return acceptedTask.name;
  }
}
