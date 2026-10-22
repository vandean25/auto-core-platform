import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VehicleController } from './vehicle.controller.js';
import { VehicleInspectionRecordController } from './vehicle-inspection-record.controller.js';
import { VehiclePartyController } from './vehicle-party.controller.js';
import { VehiclePartyService } from './vehicle-party.service.js';
import { VehicleInspectionRecordService } from './vehicle-inspection-record.service.js';
import {
  SandboxVehicleIdentityProvider,
  VEHICLE_IDENTITY_PROVIDER,
} from './vehicle-identity.provider.js';
import { VehicleIdentityService } from './vehicle-identity.service.js';
import {
  DisabledEurotaxAtVehicleValuationProvider,
  VEHICLE_VALUATION_PROVIDER,
} from './vehicle-valuation.provider.js';
import { VehicleValuationService } from './vehicle-valuation.service.js';
import { VehicleService } from './vehicle.service.js';
import { VehiclePersistenceService } from './vehicle-persistence.service.js';
import { VehiclePickerlDueService } from './vehicle-pickerl-due.service.js';
import { VehiclePickerlBarrierService } from './vehicle-pickerl-barrier.service.js';
import { VehicleWriteService } from './vehicle-write.service.js';
import { NovaCalculationService } from './nova-calculation.service.js';
import { InspectionExchangeModule } from '../inspection-exchange/inspection-exchange.module.js';

@Module({
  imports: [PrismaModule, InspectionExchangeModule],
  controllers: [
    VehicleController,
    VehicleInspectionRecordController,
    VehiclePartyController,
  ],
  providers: [
    VehicleService,
    VehiclePersistenceService,
    VehicleWriteService,
    VehiclePickerlDueService,
    VehiclePickerlBarrierService,
    NovaCalculationService,
    VehicleInspectionRecordService,
    VehiclePartyService,
    VehicleIdentityService,
    VehicleValuationService,
    SandboxVehicleIdentityProvider,
    {
      provide: VEHICLE_IDENTITY_PROVIDER,
      useExisting: SandboxVehicleIdentityProvider,
    },
    DisabledEurotaxAtVehicleValuationProvider,
    {
      provide: VEHICLE_VALUATION_PROVIDER,
      useExisting: DisabledEurotaxAtVehicleValuationProvider,
    },
  ],
  exports: [
    VehicleService,
    VehiclePickerlBarrierService,
    NovaCalculationService,
  ],
})
export class VehicleModule {}
