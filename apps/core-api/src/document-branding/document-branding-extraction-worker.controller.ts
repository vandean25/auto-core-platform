import {
  Controller,
  Body,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard.js';
import { DocumentBrandingExtractionTaskGuard } from './document-branding-extraction-task.guard.js';
import { DocumentBrandingExtractionWorkerService } from './document-branding-extraction-worker.service.js';
import type { SignedDocumentBrandingExtractionTask } from './document-branding-extraction-task.js';

@Controller('legal-entities/:legalEntityId/document-branding/extractions')
@Public()
@UseGuards(CloudTasksWorkerGuard, DocumentBrandingExtractionTaskGuard)
export class DocumentBrandingExtractionWorkerController {
  constructor(
    private readonly worker: DocumentBrandingExtractionWorkerService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post(':extractionId/worker')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async extract(
    @Param('legalEntityId') legalEntityId: string,
    @Param('extractionId') extractionId: string,
    @Body() task: SignedDocumentBrandingExtractionTask,
  ) {
    await this.worker.process(
      extractionId,
      legalEntityId,
      await this.tenantContext.getTenantId(),
      task.expectedAttemptCount,
    );
  }
}
