import { Injectable } from '@nestjs/common';
import { CloudTasksService } from '../common/services/cloud-tasks.service.js';

@Injectable()
export class DocumentBrandingUploadTaskService {
  constructor(private readonly cloudTasks: CloudTasksService) {}

  enqueue(params: { assetId: string; tenantId: string }) {
    return this.cloudTasks.enqueueDocumentBrandingAssetValidation({
      ...params,
      targetBaseUrl: process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '',
    });
  }
}
