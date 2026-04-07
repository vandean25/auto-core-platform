import { Module } from '@nestjs/common';
import { CloudTasksWorkerGuard } from './guards/cloud-tasks-worker.guard';
import { CloudTasksService } from './services/cloud-tasks.service';
import { PlaywrightBrowserService } from './services/playwright-browser.service';

@Module({
  providers: [
    CloudTasksService,
    CloudTasksWorkerGuard,
    PlaywrightBrowserService,
  ],
  exports: [
    CloudTasksService,
    CloudTasksWorkerGuard,
    PlaywrightBrowserService,
  ],
})
export class CommonModule {}
