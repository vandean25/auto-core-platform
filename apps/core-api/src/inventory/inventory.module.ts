import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { LedgerService } from './ledger.service';

@Module({
  providers: [InventoryService, LedgerService],
  controllers: [InventoryController],
  exports: [LedgerService],
})
export class InventoryModule { }
