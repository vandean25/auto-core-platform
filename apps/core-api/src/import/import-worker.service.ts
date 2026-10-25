import { Injectable } from '@nestjs/common';
import { ImportService } from './import.service.js';

@Injectable()
export class ImportWorkerService {
  constructor(private readonly importService: ImportService) {}

  runWorkerAttempt(params: {
    tenantId: string;
    jobId: string;
    phase: 'dry_run' | 'apply';
  }): Promise<void> {
    return this.importService.runImportWorkerAttempt(params);
  }

  recoverStaleJobs(): Promise<void> {
    return this.importService.recoverStaleImportJobs();
  }
}
