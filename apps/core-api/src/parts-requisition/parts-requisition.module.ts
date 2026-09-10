import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PartsRequisitionController } from './parts-requisition.controller';
import { PartsRequisitionService } from './parts-requisition.service';

@Module({
  imports: [InventoryModule, PrismaModule],
  controllers: [PartsRequisitionController],
  providers: [PartsRequisitionService],
})
export class PartsRequisitionModule {}
