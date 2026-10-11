import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CommonModule } from '../common/index.js';
import { DocumentBrandingModule } from '../document-branding/document-branding.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WarrantyClaimController } from './warranty-claim.controller.js';
import { WarrantyClaimPdfRenderer } from './warranty-claim-pdf.renderer.js';
import { WarrantyClaimPdfService } from './warranty-claim-pdf.service.js';
import { WarrantyClaimService } from './warranty-claim.service.js';

@Module({
  imports: [PrismaModule, AuditModule, CommonModule, DocumentBrandingModule],
  controllers: [WarrantyClaimController],
  providers: [
    WarrantyClaimService,
    WarrantyClaimPdfService,
    WarrantyClaimPdfRenderer,
  ],
  exports: [WarrantyClaimService],
})
export class WarrantyClaimModule {}
