import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import {
  CreditNotesController,
  InvoiceCreditNotesController,
} from './credit-notes.controller.js';
import { CreditNotesService } from './credit-notes.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [CreditNotesController, InvoiceCreditNotesController],
  providers: [CreditNotesService],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
