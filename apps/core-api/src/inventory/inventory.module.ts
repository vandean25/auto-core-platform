import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { InventoryController } from './inventory.controller.js';
import { ScopeContextModule } from '../auth/scope-context/scope-context.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LedgerService } from './ledger.service.js';
import { LocationService } from './location.service.js';
import { LocationController } from './location.controller.js';
import { AtpService } from './atp.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { InventoryItemMutationsService } from './inventory-item-mutations.service.js';
import { GuardedPriceService } from './guarded-price/guarded-price.service.js';
import { GuardedPriceDiscoveryService } from './guarded-price/guarded-price-discovery.service.js';
import { GuardedPriceFenceService } from './guarded-price/guarded-price-fence.service.js';
import { GuardedPriceOpsJobService } from './guarded-price/guarded-price-ops-job.service.js';
import { InventoryPriceOperationsController } from './inventory-price-operations.controller.js';
import { InventoryPatchBodyPipe } from './inventory-patch-body.pipe.js';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module.js';
import { InventoryValuationService } from './inventory-valuation.service.js';
import { PermissionResolver } from '../permissions/permission-resolver.js';
import { InventoryRevaluationController } from './inventory-revaluation.controller.js';
import { RevalueUnvaluedAdjustmentsService } from './revalue-unvalued-adjustments.service.js';

@Module({
  imports: [
    ScopeContextModule,
    PrismaModule,
    AuditModule,
    DashboardRealtimeModule,
  ],
  controllers: [
    LocationController,
    InventoryPriceOperationsController,
    InventoryRevaluationController,
    InventoryController,
  ],
  providers: [
    InventoryService,
    InventoryItemMutationsService,
    RevalueUnvaluedAdjustmentsService,
    GuardedPriceService,
    GuardedPriceDiscoveryService,
    GuardedPriceFenceService,
    GuardedPriceOpsJobService,
    InventoryPatchBodyPipe,
    LedgerService,
    InventoryValuationService,
    LocationService,
    AtpService,
    PermissionResolver,
  ],
  exports: [
    LedgerService,
    InventoryValuationService,
    LocationService,
    AtpService,
    InventoryService,
    GuardedPriceOpsJobService,
  ],
})
export class InventoryModule {}
