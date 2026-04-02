import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicePdfStorage } from './invoice-pdf.storage';
import { InvoicePdfRenderer } from './invoice-pdf.renderer';

@Module({
  imports: [PrismaModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    InvoicePdfService,
    InvoicePdfStorage,
    InvoicePdfRenderer,
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
