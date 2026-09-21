import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import { InvoiceSnapshotCommitService } from './invoice-snapshot-commit.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    InvoicePdfService,
    InvoicePdfRenderer,
    InvoiceSnapshotCommitService,
  ],
  exports: [InvoicesService, InvoiceSnapshotCommitService],
})
export class InvoicesModule {}
