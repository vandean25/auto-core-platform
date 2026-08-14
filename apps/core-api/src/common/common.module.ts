import { Module } from '@nestjs/common';
import { CloudTasksWorkerGuard } from './guards/cloud-tasks-worker.guard';
import { CloudTasksService } from './services/cloud-tasks.service';
import { PlaywrightBrowserService } from './services/playwright-browser.service';
import { HttpLoggingInterceptor } from './logging/http-logging.interceptor';

@Module({
  providers: [
    CloudTasksService,
    CloudTasksWorkerGuard,
    PlaywrightBrowserService,
    HttpLoggingInterceptor,
  ],
  exports: [
    CloudTasksService,
    CloudTasksWorkerGuard,
    PlaywrightBrowserService,
    HttpLoggingInterceptor,
  ],
})
export class CommonModule {}

