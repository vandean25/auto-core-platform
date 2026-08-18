import { Module } from '@nestjs/common';
import { CommonModule } from '../common';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module';
import { WorkshopBoardService } from './workshop-board.service';
import { WorkshopIntakeService } from './workshop-intake.service';
import { WorkshopInvoiceService } from './workshop-invoice.service';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import { WorkshopPdfService } from './workshop-pdf.service';
import { WorkshopPdfStorage } from './workshop-pdf.storage';
import { WorkshopPickPartsService } from './workshop-pick-parts.service';
import { WorkshopTaskService } from './workshop-task.service';
import { WorkshopController } from './workshop.controller';

@Module({
  imports: [
    PrismaModule,
    InvoicesModule,
    InventoryModule,
    CommonModule,
    VehicleStockModule,
  ],
  controllers: [WorkshopController],
  providers: [
    WorkshopIntakeService,
    WorkshopTaskService,
    WorkshopPickPartsService,
    WorkshopBoardService,
    WorkshopInvoiceService,
    WorkshopPdfService,
    WorkshopPdfRenderer,
    WorkshopPdfStorage,
  ],
})
export class WorkshopModule {}
