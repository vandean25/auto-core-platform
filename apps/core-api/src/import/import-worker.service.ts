import { Injectable } from '@nestjs/common';
import { ImportService } from './import.service.js';
import { ImportUndoService } from './import-undo.service.js';
import type { ImportWorkerPhase } from './import-job.worker-state.js';

@Injectable()
export class ImportWorkerService {
  constructor(
    private readonly importService: ImportService,
    private readonly undoService: ImportUndoService,
  ) {}

  async runWorkerAttempt(params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
  }): Promise<void> {
    if (params.phase === 'undo') {
      await this.undoService.runUndoWorkerAttempt(params);
      return;
    }
    await this.importService.runImportWorkerAttempt({
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: params.phase,
    });
  }

  async recoverStaleJobs(): Promise<boolean> {
    await this.importService.recoverStaleImportJobs();
    return this.undoService.recoverStaleUndoJobs();
  }
}
