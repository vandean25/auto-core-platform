import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EmployeeController } from './employee.controller.js';
import { EmployeeLeaveService } from './employee-leave.service.js';
import { EmployeeLifecycleService } from './employee-lifecycle.service.js';
import { EmployeeService } from './employee.service.js';

@Module({
  imports: [PrismaModule, HrModule],
  controllers: [EmployeeController],
  providers: [EmployeeService, EmployeeLifecycleService, EmployeeLeaveService],
  exports: [EmployeeService],
})
export class EmployeeModule {}
