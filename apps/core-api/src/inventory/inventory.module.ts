import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerService } from './ledger.service';
import { LocationService } from './location.service';
import { LocationController } from './location.controller';
import { AtpService } from './atp.service';

@Module({
  imports: [PrismaModule],
  controllers: [InventoryController, LocationController],
  providers: [InventoryService, LedgerService, LocationService, AtpService],
  exports: [LedgerService, LocationService, AtpService],
})
export class InventoryModule {}
