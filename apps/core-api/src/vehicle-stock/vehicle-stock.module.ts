import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VehicleLedgerService } from './vehicle-ledger.service';
import { VehiclePurchaseService } from './vehicle-purchase.service';
import { VehiclePurchaseController } from './vehicle-purchase.controller';
import { VehicleSaleService } from './vehicle-sale.service';
import { VehicleSaleController } from './vehicle-sale.controller';
import { VehicleStockQueryService } from './vehicle-stock-query.service';
import { VehicleStockController } from './vehicle-stock.controller';

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
