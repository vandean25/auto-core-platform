import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { CoreApiCronJobRegistryService } from './core-api-cron-job-registry.service.js';
import { InternalCronController } from './internal-cron.controller.js';
import { HttpCronModeGuard } from './http-cron-mode.guard.js';
import { ScheduledJobService } from './scheduled-job.service.js';
import { ScheduledJobTriggerService } from './scheduled-job-trigger.service.js';
import { ScheduledJobTriggerInterceptor } from './scheduled-job-trigger.interceptor.js';

@Module({
  imports: [CommonModule],
  controllers: [InternalCronController],
  providers: [
    CoreApiCronJobRegistryService,
    HttpCronModeGuard,
    ScheduledJobService,
    ScheduledJobTriggerService,
    ScheduledJobTriggerInterceptor,
  ],
  exports: [
    ScheduledJobService,
    ScheduledJobTriggerService,
    ScheduledJobTriggerInterceptor,
  ],
})
export class SchedulerModule {}
