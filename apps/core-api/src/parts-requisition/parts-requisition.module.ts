import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PartsRequisitionController } from './parts-requisition.controller.js';
import { PartsRequisitionService } from './parts-requisition.service.js';

@Module({
  imports: [InventoryModule, PrismaModule],
  controllers: [PartsRequisitionController],
  providers: [PartsRequisitionService],
})
export class PartsRequisitionModule {}
