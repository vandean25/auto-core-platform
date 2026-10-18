import { Module } from '@nestjs/common';
import {
  DocumentBrandingAssetsController,
  DocumentBrandingController,
} from './document-branding.controller.js';
import { DocumentBrandingCoreModule } from './document-branding-core.module.js';

@Module({
  imports: [DocumentBrandingCoreModule],
  controllers: [DocumentBrandingController, DocumentBrandingAssetsController],
})
export class DocumentBrandingHttpModule {}
