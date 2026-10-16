import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { InspectorEvidenceController } from './inspection-evidence.controller.js';
import { InspectorEvidenceService } from './inspection-evidence.service.js';

@Module({
  imports: [PrismaModule, SiteModule],
  controllers: [InspectorEvidenceController],
  providers: [InspectorEvidenceService],
  exports: [InspectorEvidenceService],
})
export class InspectorEvidenceModule {}
