import { Injectable } from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service.js';
import { runGetStaffAvailability } from './hr-staff-availability.run.js';
import { HrWorkScheduleService } from './hr-work-schedule.service.js';

export type StaffAvailabilityEmployeeRow = {
  employee_id: string;
  display_name: string;
  role: EmployeeRole;
  present_now: boolean;
  scheduled_hours: string;
  on_leave: boolean;
};

export type StaffAvailabilityQuery = {
  date?: string;
  siteId?: string;
  role?: EmployeeRole;
};

@Injectable()
export class HrStaffAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly workSchedule: HrWorkScheduleService,
    private readonly workshopSettings: WorkshopSettingsService,
  ) {}

  getStaffAvailability(query: StaffAvailabilityQuery) {
    return runGetStaffAvailability(
      {
        prisma: this.prisma,
        tenantContext: this.tenantContext,
        siteContext: this.siteContext,
        workSchedule: this.workSchedule,
        workshopSettings: this.workshopSettings,
      },
      query,
    );
  }
}
