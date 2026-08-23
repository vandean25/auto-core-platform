import { Module } from '@nestjs/common';
import { CommonModule } from '../common';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module';
import { OPENHOLIDAYS_FETCH } from './openholidays.client';
import { WorkshopBoardService } from './workshop-board.service';
import { WorkshopHolidayService } from './workshop-holiday.service';
import { WorkshopIntakeService } from './workshop-intake.service';
import { WorkshopInvoiceService } from './workshop-invoice.service';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import { WorkshopPdfService } from './workshop-pdf.service';
import { WorkshopPickPartsService } from './workshop-pick-parts.service';
import { WorkshopPlannerService } from './workshop-planner.service';
import { WorkshopScheduleService } from './workshop-schedule.service';
import { WorkshopSettingsService } from './workshop-settings.service';
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
    WorkshopSettingsService,
    WorkshopHolidayService,
    WorkshopPlannerService,
    WorkshopScheduleService,
    { provide: OPENHOLIDAYS_FETCH, useValue: fetch },
  ],
  exports: [WorkshopSettingsService],
})
export class WorkshopModule {}
