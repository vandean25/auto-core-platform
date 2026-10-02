import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LoanerBookingsController } from './loaner-bookings.controller.js';
import { LoanerVehiclesAuthorization } from './loaner-vehicles.authorization.js';
import { LoanerVehiclesController } from './loaner-vehicles.controller.js';
import { LoanerVehiclesService } from './loaner-vehicles.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [LoanerVehiclesController, LoanerBookingsController],
  providers: [LoanerVehiclesService, LoanerVehiclesAuthorization],
  exports: [LoanerVehiclesService],
})
export class LoanerVehiclesModule {}
