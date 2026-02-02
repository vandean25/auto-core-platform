import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerService } from './ledger.service';
import { LocationService } from './location.service';
import { LocationController } from './location.controller';

@Module({
  imports: [PrismaModule],
  controllers: [InventoryController, LocationController],
  providers: [InventoryService, LedgerService, LocationService],
  exports: [LedgerService, LocationService],
})
export class InventoryModule {}
