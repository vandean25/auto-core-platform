import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { InventoryController } from './inventory.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LedgerService } from './ledger.service.js';
import { LocationService } from './location.service.js';
import { LocationController } from './location.controller.js';
import { AtpService } from './atp.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { InventoryItemMutationsService } from './inventory-item-mutations.service.js';
import { GuardedPriceService } from './guarded-price/guarded-price.service.js';
import { InventoryPatchBodyPipe } from './inventory-patch-body.pipe.js';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module.js';

@Module({
  imports: [PrismaModule, AuditModule, DashboardRealtimeModule],
  controllers: [LocationController, InventoryController],
  providers: [
    InventoryService,
    InventoryItemMutationsService,
    GuardedPriceService,
    InventoryPatchBodyPipe,
    LedgerService,
    LocationService,
    AtpService,
  ],
  exports: [LedgerService, LocationService, AtpService, InventoryService],
})
export class InventoryModule {}
