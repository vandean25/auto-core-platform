import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CommonModule } from '../common/common.module.js';
import { DocumentBrandingController } from './document-branding.controller.js';
import { DocumentBrandingService } from './document-branding.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingUploadService } from './document-branding-upload.service.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';
import { DocumentBrandingUploadWorkerController } from './document-branding-upload-worker.controller.js';
import { DocumentBrandingUploadTaskGuard } from './document-branding-upload-task.guard.js';
import { DocumentBrandingUploadWorkerService } from './document-branding-upload-worker.service.js';
import { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import { DocumentBrandingUploadRecoveryService } from './document-branding-upload-recovery.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [
    DocumentBrandingController,
    DocumentBrandingUploadWorkerController,
  ],
  providers: [
    DocumentBrandingService,
    DocumentBrandingAssetStorage,
    DocumentBrandingUploadService,
    DocumentBrandingUploadTaskService,
    DocumentBrandingUploadWorkerService,
    DocumentBrandingUploadTaskGuard,
    DocumentBrandingPdfParser,
    DocumentBrandingUploadRecoveryService,
  ],
  exports: [DocumentBrandingService, DocumentBrandingUploadService],
})
export class DocumentBrandingModule {}
