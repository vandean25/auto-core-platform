import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { CommonModule } from '../../common/index.js';
import { VehicleEquipmentController } from './vehicle-equipment.controller.js';
import { VehicleEquipmentService } from './vehicle-equipment.service.js';

@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [VehicleEquipmentController],
  providers: [VehicleEquipmentService],
  exports: [VehicleEquipmentService],
})
export class VehicleEquipmentModule {}
