import { getSentryTraceHeaders } from '../observability/trace.js';
import { resolveCloudTasksOidcAudience } from './cloud-tasks.urls.js';

function calculateScheduleTime(
  delaySeconds?: number,
): { seconds: number } | undefined {
  const delay = Math.max(0, Math.floor(delaySeconds ?? 0));
  if (delay <= 0) {
    return undefined;
  }
  return { seconds: Math.floor(Date.now() / 1000) + delay };
}

export interface BuildTaskRequestParams {
  url: string;
  workerSecret: string;
  tenantId: string;
  payload: unknown;
  invokerServiceAccount: string;
  targetBaseUrl: string;
  delaySeconds?: number;
  dispatchDeadlineSeconds?: number;
}

export function buildTaskRequest(params: BuildTaskRequestParams) {
  return {
    httpRequest: {
      httpMethod: 'POST' as const,
      url: params.url,
      headers: {
        'Content-Type': 'application/json',
        'x-cloud-tasks-secret': params.workerSecret,
        'x-tenant-id': params.tenantId,
        // Continues the Sentry trace in the worker's request. Observability only, not part of the signed payload.
        ...getSentryTraceHeaders(),
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
