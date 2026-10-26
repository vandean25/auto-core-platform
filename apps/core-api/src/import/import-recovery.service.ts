import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ImportWorkerService } from './import-worker.service.js';

@Injectable()
export class ImportRecoveryService {
  private readonly logger = new Logger(ImportRecoveryService.name);

  constructor(private readonly worker: ImportWorkerService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'import-job-worker-recovery' })
  async recover(): Promise<void> {
    try {
      await this.worker.recoverStaleJobs();
    } catch (error) {
      this.logger.warn(
        `Import worker recovery failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
}
