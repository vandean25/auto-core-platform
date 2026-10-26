import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { CoreApiCronJobName } from './core-api-cron-job-name.js';
import { isCoreApiCronJobName } from './core-api-cron-job-name.js';
import { CORE_API_CRON_JOB_RUNNER_TYPES } from './core-api-cron-job-registry.js';
import type { CoreApiCronJobRunner } from './core-api-cron-job-runner.js';

@Injectable()
export class CoreApiCronJobRegistryService {
  constructor(private readonly moduleRef: ModuleRef) {}

  isKnownJobName(jobName: string): jobName is CoreApiCronJobName {
    return isCoreApiCronJobName(jobName);
  }

  async run(jobName: CoreApiCronJobName): Promise<boolean> {
    const runnerType = CORE_API_CRON_JOB_RUNNER_TYPES[jobName];
    const runner = this.moduleRef.get<CoreApiCronJobRunner>(runnerType, {
      strict: false,
    });
    return runner.run();
  }
}
