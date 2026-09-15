import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { InventoryController } from './inventory.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LedgerService } from './ledger.service.js';
import { LocationService } from './location.service.js';
import { LocationController } from './location.controller.js';
import { AtpService } from './atp.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [InventoryController, LocationController],
  providers: [InventoryService, LedgerService, LocationService, AtpService],
  exports: [LedgerService, LocationService, AtpService],
})
export class InventoryModule {}
