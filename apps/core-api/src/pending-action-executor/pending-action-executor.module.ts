import { Module } from '@nestjs/common';
import { PartsRequisitionModule } from '../parts-requisition/parts-requisition.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SiteModule } from '../site/site.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { LoanerVehiclesModule } from '../loaner-vehicles/loaner-vehicles.module.js';
import { RegistrationIntakeModule } from '../registration-intake/registration-intake.module.js';
import { PendingActionExecutorService } from './pending-action-executor.service.js';

@Module({
  imports: [
    PrismaModule,
    SiteModule,
    WorkshopModule,
    LoanerVehiclesModule,
    PartsRequisitionModule,
    RegistrationIntakeModule,
  ],
  providers: [PendingActionExecutorService],
  exports: [PendingActionExecutorService],
})
export class PendingActionExecutorModule {}
