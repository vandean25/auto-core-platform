import { Module } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { HrAttendanceSchedulerService } from './hr-attendance-scheduler.service.js';
import { HrAttendanceService } from './hr-attendance.service.js';
import { HrIdentityService } from './hr-identity.service.js';
import { HrLeaveService } from './hr-leave.service.js';
import { HrWorkScheduleService } from './hr-work-schedule.service.js';
import { HrWorkdayService } from './hr-workday.service.js';
import { HrController } from './hr.controller.js';

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
