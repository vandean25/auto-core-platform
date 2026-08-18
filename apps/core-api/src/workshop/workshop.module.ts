import { Module } from '@nestjs/common';
import { CommonModule } from '../common';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module';
import { WorkshopPdfService } from './workshop-pdf.service';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import { WorkshopController } from './workshop.controller';
import { WorkshopService } from './workshop.service';

@Module({
  imports: [
    PrismaModule,
    InvoicesModule,
    InventoryModule,
    CommonModule,
    VehicleStockModule,
  ],
  controllers: [WorkshopController],
  providers: [WorkshopService, WorkshopPdfService, WorkshopPdfRenderer],
})
export class WorkshopModule {}
