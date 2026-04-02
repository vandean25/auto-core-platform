import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VehicleController } from './vehicle.controller';
import { VehicleService } from './vehicle.service';

@Module({
  imports: [PrismaModule],
  controllers: [VehicleController],
  providers: [VehicleService],
})
export class VehicleModule {}
