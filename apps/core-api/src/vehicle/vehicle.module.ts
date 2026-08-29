import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VehicleController } from './vehicle.controller';
import {
  SandboxVehicleIdentityProvider,
  VEHICLE_IDENTITY_PROVIDER,
} from './vehicle-identity.provider';
import { VehicleIdentityService } from './vehicle-identity.service';
import { VehicleService } from './vehicle.service';

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
