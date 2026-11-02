import { Module } from '@nestjs/common';
import { ImportController } from './import.controller.js';
import { ImportMappingProfileService } from './import-mapping-profile.service.js';
import { ImportRetentionService } from './import-retention.service.js';
import { ImportUploadRetentionService } from './import-upload-retention.service.js';
import { ImportService } from './import.service.js';
import { ImportDirectUploadService } from './import-direct-upload.service.js';
import { ImportDirectUploadStorageService } from './import-direct-upload.storage.js';
import { ImportFileStorageService } from './import-file.storage.js';
import { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import { ImportWorkerService } from './import-worker.service.js';
import { ImportWorkerController } from './import-worker.controller.js';
import { ImportRecoveryService } from './import-recovery.service.js';
import { ImportTaskGuard } from './import-task.guard.js';
import { ImportSourceService } from './import-source.service.js';
import { ImportUndoPreviewService } from './import-undo.preview.service.js';
import { ImportUndoService } from './import-undo.service.js';
import { ImportPurgeWorkerController } from './import-purge-worker.controller.js';
import { ImportPurgeWorkerService } from './import-purge-worker.service.js';
import { ImportPurgeTaskGuard } from './import-purge-task.guard.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';

@Module({
  imports: [SchedulerModule],
  controllers: [
    ImportController,
    ImportWorkerController,
    ImportPurgeWorkerController,
  ],
  providers: [
    ImportService,
    ImportDirectUploadService,
    ImportDirectUploadStorageService,
    ImportMappingProfileService,
    ImportRetentionService,
    ImportUploadRetentionService,
    ImportFileStorageService,
    ImportCloudTasksService,
    ImportWorkerService,
    ImportRecoveryService,
    ImportTaskGuard,
    ImportSourceService,
    ImportUndoPreviewService,
    ImportUndoService,
    ImportPurgeWorkerService,
    ImportPurgeTaskGuard,
  ],
  exports: [ImportRetentionService, ImportPurgeWorkerService],
})
export class ImportModule {}
