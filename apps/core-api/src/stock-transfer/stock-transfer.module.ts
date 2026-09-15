import { Module } from '@nestjs/common';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StockTransferController } from './stock-transfer.controller.js';
import { StockTransferService } from './stock-transfer.service.js';

@Module({
  imports: [PrismaModule, InventoryModule, DashboardRealtimeModule],
  controllers: [StockTransferController],
  providers: [StockTransferService],
  exports: [StockTransferService],
})
export class StockTransferModule {}
