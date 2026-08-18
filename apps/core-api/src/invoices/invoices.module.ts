import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { CommonModule } from '../common';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicePdfRenderer } from './invoice-pdf.renderer';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePdfService, InvoicePdfRenderer],
  exports: [InvoicesService],
})
export class InvoicesModule {}
