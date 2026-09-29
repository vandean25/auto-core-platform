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
import {
  DOCUMENT_BRAND_EXTRACTION_PROVIDER,
  DisabledDocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';
import { DocumentBrandingExtractionService } from './document-branding-extraction.service.js';
import { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';
import { DocumentBrandingExtractionTaskGuard } from './document-branding-extraction-task.guard.js';
import { DocumentBrandingExtractionWorkerController } from './document-branding-extraction-worker.controller.js';
import { DocumentBrandingExtractionWorkerService } from './document-branding-extraction-worker.service.js';
import { DocumentBrandingExtractionImageProcessor } from './document-branding-extraction-image-processor.js';
import { DocumentBrandingExtractionRecoveryService } from './document-branding-extraction-recovery.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [
    DocumentBrandingController,
    DocumentBrandingUploadWorkerController,
    DocumentBrandingExtractionWorkerController,
  ],
  providers: [
    DocumentBrandingService,
    DocumentBrandingExtractionService,
    DocumentBrandingExtractionTaskService,
    DocumentBrandingExtractionTaskGuard,
    DocumentBrandingExtractionWorkerService,
    DocumentBrandingExtractionRecoveryService,
    DocumentBrandingExtractionImageProcessor,
    {
      provide: DOCUMENT_BRAND_EXTRACTION_PROVIDER,
      useClass: DisabledDocumentBrandingExtractionProvider,
    },
    DocumentBrandingAssetStorage,
    DocumentBrandingUploadService,
    DocumentBrandingUploadTaskService,
    DocumentBrandingUploadWorkerService,
    DocumentBrandingUploadTaskGuard,
    DocumentBrandingPdfParser,
    DocumentBrandingUploadRecoveryService,
  ],
  exports: [
    DocumentBrandingService,
    DocumentBrandingUploadService,
    DocumentBrandingAssetStorage,
  ],
})
export class DocumentBrandingModule {}
