import {
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
import { DocumentBrandingUploadTaskGuard } from './document-branding-upload-task.guard.js';
import { DocumentBrandingUploadWorkerService } from './document-branding-upload-worker.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';

@Controller('document-branding/assets')
@Public()
@UseGuards(CloudTasksWorkerGuard, DocumentBrandingUploadTaskGuard)
export class DocumentBrandingUploadWorkerController {
  constructor(
    private readonly worker: DocumentBrandingUploadWorkerService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post(':assetId/worker')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async validate(@Param('assetId') assetId: string) {
    await this.worker.validate(assetId, await this.tenantContext.getTenantId());
  }
}
