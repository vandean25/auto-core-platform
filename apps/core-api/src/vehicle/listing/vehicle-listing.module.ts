import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { CommonModule } from '../../common/index.js';
import { VehicleStockModule } from '../../vehicle-stock/vehicle-stock.module.js';
import { Autoscout24DmsModule } from '../listing-export/autoscout24-dms.module.js';
import { VehicleListingExportController } from '../listing-export/vehicle-listing-export.controller.js';
import { VehicleListingExportService } from '../listing-export/vehicle-listing-export.service.js';
import { VehicleListingController } from './vehicle-listing.controller.js';
import { VehicleListingService } from './vehicle-listing.service.js';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    VehicleStockModule,
    Autoscout24DmsModule,
  ],
  controllers: [VehicleListingController, VehicleListingExportController],
  providers: [VehicleListingService, VehicleListingExportService],
  exports: [VehicleListingService, VehicleListingExportService],
})
export class VehicleListingModule {}
