import { Module } from '@nestjs/common';
import { CommonModule } from '../common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkshopModule } from '../workshop/workshop.module';
import { HrAttendanceSchedulerService } from './hr-attendance-scheduler.service';
import { HrAttendanceService } from './hr-attendance.service';
import { HrIdentityService } from './hr-identity.service';
import { HrLeaveService } from './hr-leave.service';
import { HrWorkdayService } from './hr-workday.service';
import { HrController } from './hr.controller';

@Module({
  imports: [PrismaModule, CommonModule, WorkshopModule],
  controllers: [HrController],
  providers: [
    HrIdentityService,
    HrAttendanceService,
    HrAttendanceSchedulerService,
    HrWorkdayService,
    HrLeaveService,
  ],
  exports: [
    HrIdentityService,
    HrAttendanceService,
    HrAttendanceSchedulerService,
    HrWorkdayService,
    HrLeaveService,
  ],
})
export class HrModule {}
