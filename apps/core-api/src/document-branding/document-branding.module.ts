import { Module } from '@nestjs/common';
import { DocumentBrandingCoreModule } from './document-branding-core.module.js';
import { DocumentBrandingHttpModule } from './document-branding-http.module.js';

@Module({
  imports: [DocumentBrandingCoreModule, DocumentBrandingHttpModule],
  exports: [DocumentBrandingCoreModule],
})
export class DocumentBrandingModule {}
