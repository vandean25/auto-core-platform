import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard.js';
import { ImportPurgeTaskGuard } from './import-purge-task.guard.js';
import type { SignedImportPurgeTaskPayload } from './import-purge-task.payload.js';
import { ImportPurgeWorkerService } from './import-purge-worker.service.js';

@Controller('imports/maintenance/row-purge')
@Public()
@UseGuards(CloudTasksWorkerGuard, ImportPurgeTaskGuard)
export class ImportPurgeWorkerController {
  constructor(private readonly purgeWorkerService: ImportPurgeWorkerService) {}

  @Post('worker')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async runWorker(@Body() task: SignedImportPurgeTaskPayload): Promise<void> {
    await this.purgeWorkerService.processPurgeBatch({
      runId: task.runId,
      sequence: task.sequence,
    });
  }
}
