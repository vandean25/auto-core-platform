import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { CommonModule } from '../../common/index.js';
import { VehicleListingController } from './vehicle-listing.controller.js';
import { VehicleListingService } from './vehicle-listing.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [VehicleListingController],
  providers: [VehicleListingService],
  exports: [VehicleListingService],
})
export class VehicleListingModule {}
