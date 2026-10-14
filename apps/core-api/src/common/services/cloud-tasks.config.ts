import { InternalServerErrorException } from '@nestjs/common';

export interface RequiredCloudTasksEnv {
  workerSecret: string;
  location: string;
  queue: string;
  invokerServiceAccount: string;
}

export const CLOUD_TASKS_NOT_ENABLED_MESSAGE =
  'Cloud Tasks is not enabled or not configured';

const CLOUD_TASKS_MISSING_CONFIG_MESSAGE =
  'Cloud Tasks is missing required configuration environment variables';

export function getRequiredCloudTasksEnv(): RequiredCloudTasksEnv {
  const workerSecret = process.env.CLOUD_TASKS_WORKER_SECRET;
  const location = process.env.CLOUD_TASKS_LOCATION;
  const queue = process.env.CLOUD_TASKS_QUEUE;
  const invokerServiceAccount = process.env.CLOUD_TASKS_INVOKER_SA;

  if (!workerSecret || !location || !queue || !invokerServiceAccount) {
    throw new InternalServerErrorException(CLOUD_TASKS_MISSING_CONFIG_MESSAGE);
  }

  return { workerSecret, location, queue, invokerServiceAccount };
}

export function isCloudTasksEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured =
    Boolean(env.CLOUD_TASKS_LOCATION) &&
    Boolean(env.CLOUD_TASKS_QUEUE) &&
    Boolean(env.CLOUD_TASKS_WORKER_SECRET) &&
    Boolean(env.CLOUD_TASKS_INVOKER_SA);
  if (!configured) {
    return false;
  }

  const flag = env.CLOUD_TASKS_ENABLED;
  if (flag === 'true') return true;
  if (flag === 'false') return false;

  return env.NODE_ENV === 'production';
}
