import { Module } from '@nestjs/common';
import { CommonModule } from '../common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkshopModule } from '../workshop/workshop.module';
import { HrAttendanceSchedulerService } from './hr-attendance-scheduler.service';
import { HrAttendanceService } from './hr-attendance.service';
import { HrIdentityService } from './hr-identity.service';
import { HrLeaveService } from './hr-leave.service';
import { HrWorkScheduleService } from './hr-work-schedule.service';
import { HrWorkdayService } from './hr-workday.service';
import { HrController } from './hr.controller';

@Module({
  imports: [PrismaModule, CommonModule, WorkshopModule],
  controllers: [HrController],
  providers: [
    HrIdentityService,
    HrAttendanceService,
    HrAttendanceSchedulerService,
    HrWorkScheduleService,
    HrWorkdayService,
    HrLeaveService,
  ],
  exports: [
    HrIdentityService,
    HrAttendanceService,
    HrAttendanceSchedulerService,
    HrWorkScheduleService,
    HrWorkdayService,
    HrLeaveService,
  ],
})
export class HrModule {}
