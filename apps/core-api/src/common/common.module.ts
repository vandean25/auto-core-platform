import { Module } from '@nestjs/common';
import { CloudTasksWorkerGuard } from './guards/cloud-tasks-worker.guard.js';
import { PdfStorage } from './pdf/pdf-storage.js';
import { PdfTaskTenantGuard } from './pdf/pdf-task-tenant.guard.js';
import { CloudTasksService } from './services/cloud-tasks.service.js';
import { PlaywrightBrowserService } from './services/playwright-browser.service.js';
import { HttpLoggingInterceptor } from './logging/http-logging.interceptor.js';
import { LogLevelService } from './logging/log-level.service.js';

@Module({
  providers: [
    CloudTasksService,
    CloudTasksWorkerGuard,
    PdfStorage,
    PdfTaskTenantGuard,
    PlaywrightBrowserService,
    HttpLoggingInterceptor,
    LogLevelService,
  ],
  exports: [
    CloudTasksService,
    CloudTasksWorkerGuard,
    PdfStorage,
    PdfTaskTenantGuard,
    PlaywrightBrowserService,
    HttpLoggingInterceptor,
    LogLevelService,
  ],
})
export class CommonModule {}
