import { Module } from '@nestjs/common';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StockTransferAccessService } from './stock-transfer-access.service.js';
import { StockTransferCommandService } from './stock-transfer-command.service.js';
import { StockTransferCommitService } from './stock-transfer-commit.service.js';
import { StockTransferController } from './stock-transfer.controller.js';
import { StockTransferLedgerPostingService } from './stock-transfer-ledger-posting.service.js';
import { StockTransferMutationService } from './stock-transfer-mutation.service.js';
import { StockTransferQueryService } from './stock-transfer-query.service.js';
import { StockTransferSiteLockService } from './stock-transfer-site-lock.service.js';
import { StockTransferService } from './stock-transfer.service.js';

@Module({
  imports: [PrismaModule, InventoryModule, DashboardRealtimeModule],
  controllers: [StockTransferController],
  providers: [
    StockTransferAccessService,
    StockTransferQueryService,
    StockTransferSiteLockService,
    StockTransferLedgerPostingService,
    StockTransferCommandService,
    StockTransferCommitService,
    StockTransferMutationService,
    StockTransferService,
  ],
  exports: [StockTransferService],
})
export class StockTransferModule {}
