import { Module } from '@nestjs/common';
import { PartsRequisitionModule } from '../parts-requisition/parts-requisition.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { PendingActionExecutorService } from './pending-action-executor.service.js';

@Module({
  imports: [PrismaModule, SiteModule, WorkshopModule, PartsRequisitionModule],
  providers: [PendingActionExecutorService],
  exports: [PendingActionExecutorService],
})
export class PendingActionExecutorModule {}
