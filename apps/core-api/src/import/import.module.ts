import { Module } from '@nestjs/common';
import { ImportController } from './import.controller.js';
import { ImportMappingProfileService } from './import-mapping-profile.service.js';
import { ImportRetentionService } from './import-retention.service.js';
import { ImportUploadRetentionService } from './import-upload-retention.service.js';
import { ImportService } from './import.service.js';
import { ImportFileStorageService } from './import-file.storage.js';
import { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import { ImportWorkerService } from './import-worker.service.js';
import { ImportWorkerController } from './import-worker.controller.js';
import { ImportRecoveryService } from './import-recovery.service.js';
import { ImportTaskGuard } from './import-task.guard.js';

@Module({
  controllers: [ImportController, ImportWorkerController],
  providers: [
    ImportService,
    ImportMappingProfileService,
    ImportRetentionService,
    ImportUploadRetentionService,
    ImportFileStorageService,
    ImportCloudTasksService,
    ImportWorkerService,
    ImportRecoveryService,
    ImportTaskGuard,
  ],
})
export class ImportModule {}
