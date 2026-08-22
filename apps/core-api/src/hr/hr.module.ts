import { Module } from '@nestjs/common';
import { HrAttendanceSchedulerService } from './hr-attendance-scheduler.service';
import { HrAttendanceService } from './hr-attendance.service';
import { HrIdentityService } from './hr-identity.service';
import { HrController } from './hr.controller';

@Module({
  controllers: [HrController],
  providers: [
    HrIdentityService,
    HrAttendanceService,
    HrAttendanceSchedulerService,
  ],
  exports: [
    HrIdentityService,
    HrAttendanceService,
    HrAttendanceSchedulerService,
  ],
})
export class HrModule {}
