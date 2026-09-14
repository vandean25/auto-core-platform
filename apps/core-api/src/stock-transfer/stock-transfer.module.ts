import { Module } from '@nestjs/common';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StockTransferController } from './stock-transfer.controller';
import { StockTransferService } from './stock-transfer.service';

@Module({
  imports: [PrismaModule, InventoryModule, DashboardRealtimeModule],
  controllers: [StockTransferController],
  providers: [StockTransferService],
  exports: [StockTransferService],
})
export class StockTransferModule {}
