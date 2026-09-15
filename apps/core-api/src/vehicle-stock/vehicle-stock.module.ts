import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import { VehiclePurchaseService } from './vehicle-purchase.service.js';
import { VehiclePurchaseController } from './vehicle-purchase.controller.js';
import { VehicleSaleService } from './vehicle-sale.service.js';
import { VehicleSaleController } from './vehicle-sale.controller.js';
import { VehicleStockQueryService } from './vehicle-stock-query.service.js';
import { VehicleStockController } from './vehicle-stock.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [
    VehiclePurchaseController,
    VehicleSaleController,
    VehicleStockController,
  ],
  providers: [
    VehicleLedgerService,
    VehiclePurchaseService,
    VehicleSaleService,
    VehicleStockQueryService,
  ],
  exports: [VehicleLedgerService, VehicleSaleService],
})
export class VehicleStockModule {}
