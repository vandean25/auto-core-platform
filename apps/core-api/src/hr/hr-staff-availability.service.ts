import { Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service.js';
import { assertMcpStaffAvailabilityAccess } from './hr-staff-availability.access.js';
import {
  loadOnLeaveEmployeeIds,
  loadPresentNowEmployeeIds,
  loadScheduledHoursForDate,
  resolveStaffAvailabilityDate,
} from './hr-staff-availability.loaders.js';
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

  async getStaffAvailability(query: StaffAvailabilityQuery): Promise<{
    date: string;
    site_id: string;
    employees: StaffAvailabilityEmployeeRow[];
  }> {
    assertMcpStaffAvailabilityAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = query.siteId ?? (await this.siteContext.getSiteId());
    await this.assertSiteAuthorized(siteId);

    const date = await resolveStaffAvailabilityDate(
      this.workshopSettings,
      tenantId,
      siteId,
      query.date,
    );

    const employees = await this.prisma.employee.findMany({
      where: {
        tenant_id: tenantId,
        is_active: true,
        ...(query.role ? { role: query.role } : {}),
      },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, role: true },
    });

    if (employees.length === 0) {
      return { date, site_id: siteId, employees: [] };
    }

    const employeeIds = employees.map((row) => row.id);
    const [onLeaveIds, presentIds, scheduledHours] = await Promise.all([
      loadOnLeaveEmployeeIds(this.prisma, tenantId, employeeIds, date),
      loadPresentNowEmployeeIds(this.prisma, tenantId, employeeIds),
      loadScheduledHoursForDate(this.workSchedule, tenantId, employeeIds, date),
    ]);

    return {
      date,
      site_id: siteId,
      employees: employees.map((employee) => ({
        employee_id: employee.id,
        display_name: employee.name,
        role: employee.role,
        present_now: presentIds.has(employee.id),
        scheduled_hours: scheduledHours.get(employee.id) ?? '0.00',
        on_leave: onLeaveIds.has(employee.id),
      })),
    };
  }

  private async assertSiteAuthorized(siteId: string): Promise<void> {
    const allowed = await this.siteContext.listAuthorizedSiteIds();
    if (!allowed.includes(siteId)) {
      throw new NotFoundException(`Site ${siteId} not found`);
    }
  }
}
