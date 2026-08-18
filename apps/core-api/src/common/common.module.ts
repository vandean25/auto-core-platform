import { Module } from '@nestjs/common';
import { CloudTasksWorkerGuard } from './guards/cloud-tasks-worker.guard';
import { PdfStorage } from './pdf/pdf-storage';
import { PdfTaskTenantGuard } from './pdf/pdf-task-tenant.guard';
import { CloudTasksService } from './services/cloud-tasks.service';
import { PlaywrightBrowserService } from './services/playwright-browser.service';
import { HttpLoggingInterceptor } from './logging/http-logging.interceptor';
import { LogLevelService } from './logging/log-level.service';

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
