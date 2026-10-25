import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard.js';
import { ImportTaskGuard } from './import-task.guard.js';
import type { SignedImportTaskPayload } from './import-task.payload.js';
import { ImportWorkerService } from './import-worker.service.js';

@Controller('imports')
@Public()
@UseGuards(CloudTasksWorkerGuard, ImportTaskGuard)
export class ImportWorkerController {
  constructor(private readonly worker: ImportWorkerService) {}

  @Post(':id/worker')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async runWorker(
    @Param('id') jobId: string,
    @Body() task: SignedImportTaskPayload,
  ): Promise<void> {
    await this.worker.runWorkerAttempt({
      tenantId: task.tenantId,
      jobId,
      phase: task.phase,
    });
  }
}
