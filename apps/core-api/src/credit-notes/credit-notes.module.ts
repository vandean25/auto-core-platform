import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { InvoicePdfRenderer } from '../invoices/invoice-pdf.renderer.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CreditNotePdfService } from './credit-note-pdf.service.js';
import {
  CreditNotesController,
  InvoiceCreditNotesController,
} from './credit-notes.controller.js';
import { CreditNotesService } from './credit-notes.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [CreditNotesController, InvoiceCreditNotesController],
  providers: [CreditNotesService, CreditNotePdfService, InvoicePdfRenderer],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
