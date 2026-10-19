import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../common/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { HrAttendanceSchedulerService } from './hr-attendance-scheduler.service.js';
import { HrAttendanceService } from './hr-attendance.service.js';
import { HrIdentityService } from './hr-identity.service.js';
import { HrLeaveService } from './hr-leave.service.js';
import { HrWorkScheduleReader } from './hr-work-schedule-reader.service.js';
import { HrWorkScheduleSeeder } from './hr-work-schedule-seeder.service.js';
import { HrWorkScheduleWriter } from './hr-work-schedule-writer.service.js';
import { HrWorkScheduleService } from './hr-work-schedule.service.js';
import { HrWorkdayService } from './hr-workday.service.js';
import { HrController } from './hr.controller.js';
import { HrStaffAvailabilityService } from './hr-staff-availability.service.js';

@Module({
  imports: [PrismaModule, CommonModule, forwardRef(() => WorkshopModule)],
  controllers: [HrController],
  providers: [
    HrIdentityService,
    HrAttendanceService,
    HrAttendanceSchedulerService,
    HrWorkScheduleReader,
    HrWorkScheduleWriter,
    HrWorkScheduleSeeder,
    HrWorkScheduleService,
    HrWorkdayService,
    HrLeaveService,
    HrStaffAvailabilityService,
  ],
  exports: [
    HrIdentityService,
    HrAttendanceService,
    HrAttendanceSchedulerService,
    HrWorkScheduleService,
    HrWorkdayService,
    HrLeaveService,
    HrStaffAvailabilityService,
  ],
})
export class HrModule {}
