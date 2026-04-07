import { Module } from '@nestjs/common';
import { WorkshopService } from './workshop.service';
import { WorkshopController } from './workshop.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { WorkshopPdfService } from './workshop-pdf.service';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import { WorkshopPdfStorage } from './workshop-pdf.storage';
import { CloudTasksService } from '../common';
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard';
@Module({
  imports: [PrismaModule, InvoicesModule],
  controllers: [WorkshopController],
  providers: [
    WorkshopService,
    WorkshopPdfService,
    WorkshopPdfRenderer,
    WorkshopPdfStorage,
    CloudTasksService,
    CloudTasksWorkerGuard,
  ],
})
export class WorkshopModule {}
