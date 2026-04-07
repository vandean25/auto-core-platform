import { Module } from '@nestjs/common';
import { CommonModule } from '../common';
import { InvoicesModule } from '../invoices/invoices.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkshopPdfService } from './workshop-pdf.service';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import { WorkshopPdfStorage } from './workshop-pdf.storage';
import { WorkshopController } from './workshop.controller';
import { WorkshopService } from './workshop.service';

@Module({
  imports: [PrismaModule, InvoicesModule, CommonModule],
  controllers: [WorkshopController],
  providers: [
    WorkshopService,
    WorkshopPdfService,
    WorkshopPdfRenderer,
    WorkshopPdfStorage,
  ],
})
export class WorkshopModule {}
