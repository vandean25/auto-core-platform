import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { CoreApiCronJobRegistryService } from './core-api-cron-job-registry.service.js';
import { InternalCronController } from './internal-cron.controller.js';
import { HttpCronModeGuard } from './http-cron-mode.guard.js';

@Module({
  imports: [CommonModule],
  controllers: [InternalCronController],
  providers: [CoreApiCronJobRegistryService, HttpCronModeGuard],
})
export class SchedulerModule {}
