import { Module } from '@nestjs/common';
import { CloudTasksWorkerGuard } from './guards/cloud-tasks-worker.guard';
import { CloudTasksService } from './services/cloud-tasks.service';
import { PlaywrightBrowserService } from './services/playwright-browser.service';
import { HttpLoggingInterceptor } from './logging/http-logging.interceptor';
import { LogLevelService } from './logging/log-level.service';

@Module({
  providers: [
    CloudTasksService,
    CloudTasksWorkerGuard,
    PlaywrightBrowserService,
    HttpLoggingInterceptor,
    LogLevelService,
  ],
  exports: [
    CloudTasksService,
    CloudTasksWorkerGuard,
    PlaywrightBrowserService,
    HttpLoggingInterceptor,
    LogLevelService,
  ],
})
export class CommonModule {}
