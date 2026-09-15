import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { VehicleController } from './vehicle.controller.js';
import {
  SandboxVehicleIdentityProvider,
  VEHICLE_IDENTITY_PROVIDER,
} from './vehicle-identity.provider.js';
import { VehicleIdentityService } from './vehicle-identity.service.js';
import { VehicleService } from './vehicle.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [VehicleController],
  providers: [
    VehicleService,
    VehicleIdentityService,
    SandboxVehicleIdentityProvider,
    {
      provide: VEHICLE_IDENTITY_PROVIDER,
      useExisting: SandboxVehicleIdentityProvider,
    },
  ],
})
export class VehicleModule {}
