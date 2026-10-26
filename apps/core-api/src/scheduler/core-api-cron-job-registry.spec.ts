import { CORE_API_CRON_JOB_NAMES } from './core-api-cron-job-names.js';
import { CORE_API_CRON_JOB_RUNNER_TYPES } from './core-api-cron-job-registry.js';
import { isCoreApiCronJobName } from './core-api-cron-job-name.js';

describe('CORE_API_CRON_JOB_RUNNER_TYPES', () => {
  it('covers every documented cron name exactly once', () => {
    for (const name of CORE_API_CRON_JOB_NAMES) {
      expect(CORE_API_CRON_JOB_RUNNER_TYPES[name]).toBeDefined();
      expect(isCoreApiCronJobName(name)).toBe(true);
    }
    expect(Object.keys(CORE_API_CRON_JOB_RUNNER_TYPES)).toHaveLength(
      CORE_API_CRON_JOB_NAMES.length,
    );
  });
});
