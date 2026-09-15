import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module.js';
import { PartsRequisitionModule } from '../parts-requisition/parts-requisition.module.js';
import { OPENHOLIDAYS_FETCH } from './openholidays.client.js';
import { WorkshopBoardService } from './workshop-board.service.js';
import { WorkshopHolidayService } from './workshop-holiday.service.js';
import { WorkshopIntakeService } from './workshop-intake.service.js';
import { WorkshopInvoiceService } from './workshop-invoice.service.js';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer.js';
import { WorkshopPdfService } from './workshop-pdf.service.js';
import { WorkshopPickPartsService } from './workshop-pick-parts.service.js';
import { WorkshopPlannerService } from './workshop-planner.service.js';
import { WorkshopScheduleService } from './workshop-schedule.service.js';
import { WorkshopSettingsService } from './workshop-settings.service.js';
import { WorkshopTaskService } from './workshop-task.service.js';
import { WorkshopCatalogLineService } from './workshop-catalog-line.service.js';
import { WorkshopController } from './workshop.controller.js';

@Module({
  imports: [
    PrismaModule,
    InvoicesModule,
    InventoryModule,
    CommonModule,
    VehicleStockModule,
    PartsRequisitionModule,
  ],
  controllers: [WorkshopController],
  providers: [
    WorkshopIntakeService,
    WorkshopTaskService,
    WorkshopCatalogLineService,
    WorkshopPickPartsService,
    WorkshopBoardService,
    WorkshopInvoiceService,
    WorkshopPdfService,
    WorkshopPdfRenderer,
    WorkshopSettingsService,
    WorkshopHolidayService,
    WorkshopPlannerService,
    WorkshopScheduleService,
    { provide: OPENHOLIDAYS_FETCH, useValue: fetch },
  ],
  exports: [WorkshopSettingsService],
})
export class WorkshopModule {}
