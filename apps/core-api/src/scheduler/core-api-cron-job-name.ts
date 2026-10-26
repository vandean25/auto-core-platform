import { CORE_API_CRON_JOB_NAMES } from './core-api-cron-job-names.js';

export type CoreApiCronJobName = (typeof CORE_API_CRON_JOB_NAMES)[number];

export function isCoreApiCronJobName(
  jobName: string,
): jobName is CoreApiCronJobName {
  return (CORE_API_CRON_JOB_NAMES as readonly string[]).includes(jobName);
}
