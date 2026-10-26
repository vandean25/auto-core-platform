import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ImportWorkerService } from './import-worker.service.js';

@Injectable()
export class ImportRecoveryService {
  constructor(private readonly worker: ImportWorkerService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'import-job-worker-recovery' })
  async recover(): Promise<void> {
    await this.run();
  }

  async run(): Promise<boolean> {
    return this.worker.recoverStaleJobs();
  }
}
