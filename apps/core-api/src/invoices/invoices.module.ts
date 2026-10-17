import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import { InvoiceSnapshotCommitService } from './invoice-snapshot-commit.service.js';
import { DocumentBrandingModule } from '../document-branding/document-branding.module.js';
import { InvoiceWorkshopDraftProposeService } from './invoice-workshop-draft-propose.service.js';

@Module({
  imports: [PrismaModule, CommonModule, DocumentBrandingModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    InvoicePdfService,
    InvoicePdfRenderer,
    InvoiceSnapshotCommitService,
    InvoiceWorkshopDraftProposeService,
  ],
  exports: [
    InvoicesService,
    InvoiceSnapshotCommitService,
    InvoiceWorkshopDraftProposeService,
  ],
})
export class InvoicesModule {}
