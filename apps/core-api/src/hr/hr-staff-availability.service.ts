import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeRole, LeaveRequestStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  formatLocalDate,
  isoWeekdayFromUtcDate,
  parseLocalDate,
} from '../workshop/workshop-planner.time.js';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service.js';
import { deriveAttendanceState } from './hr-attendance.service.js';
import { HrWorkScheduleService } from './hr-work-schedule.service.js';
import { expectedMinutesForScheduleDay } from './hr-work-schedule.time.js';

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
    this.assertOwnerAdminForMcp();
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = query.siteId ?? (await this.siteContext.getSiteId());
    await this.assertSiteAuthorized(siteId);

    const settings = await this.workshopSettings.getSettingsForSite(
      tenantId,
      siteId,
    );
    const date = query.date ?? formatLocalDate(new Date(), settings.timezone);
    parseLocalDate(date);

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
    const onLeaveIds = await this.loadOnLeaveEmployeeIds(
      tenantId,
      employeeIds,
      date,
    );
    const presentIds = await this.loadPresentNowEmployeeIds(
      tenantId,
      employeeIds,
    );
    const scheduledHours = await this.loadScheduledHoursForDate(
      tenantId,
      employeeIds,
      date,
    );

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

  private assertOwnerAdminForMcp(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException({
        code: 'not_permitted',
        message: 'Tenant admin access is required.',
      });
    }
  }

  private async assertSiteAuthorized(siteId: string): Promise<void> {
    const allowed = await this.siteContext.listAuthorizedSiteIds();
    if (!allowed.includes(siteId)) {
      throw new NotFoundException(`Site ${siteId} not found`);
    }
  }

  private async loadOnLeaveEmployeeIds(
    tenantId: string,
    employeeIds: string[],
    date: string,
  ): Promise<Set<string>> {
    const target = new Date(`${date}T00:00:00.000Z`);
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        tenant_id: tenantId,
        employee_id: { in: employeeIds },
        status: LeaveRequestStatus.BOOKED,
        start_on: { lte: target },
        end_on: { gte: target },
      },
      select: { employee_id: true },
    });
    return new Set(rows.map((row) => row.employee_id));
  }

  private async loadPresentNowEmployeeIds(
    tenantId: string,
    employeeIds: string[],
  ): Promise<Set<string>> {
    const events = await this.prisma.attendanceEvent.findMany({
      where: {
        tenant_id: tenantId,
        employee_id: { in: employeeIds },
      },
      orderBy: [{ occurred_at: 'desc' }, { createdAt: 'desc' }],
      select: {
        employee_id: true,
        type: true,
        occurred_at: true,
        createdAt: true,
      },
    });

    const lastByEmployee = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      if (!lastByEmployee.has(event.employee_id)) {
        lastByEmployee.set(event.employee_id, event);
      }
    }

    const present = new Set<string>();
    for (const [employeeId, event] of lastByEmployee) {
      const state = deriveAttendanceState(event.type);
      if (
        state === 'CLOCKED_IN' ||
        state === 'PAUSED' ||
        state === 'AT_DOCTOR'
      ) {
        present.add(employeeId);
      }
    }
    return present;
  }

  private async loadScheduledHoursForDate(
    tenantId: string,
    employeeIds: string[],
    date: string,
  ): Promise<Map<string, string>> {
    const { year, month, day } = parseLocalDate(date);
    const weekday = isoWeekdayFromUtcDate(year, month, day);
    const result = new Map<string, string>();

    await Promise.all(
      employeeIds.map(async (employeeId) => {
        try {
          const schedule = await this.workSchedule.resolveScheduleForDate(
            tenantId,
            employeeId,
            date,
          );
          const dayRow = schedule.days.find((row) => row.weekday === weekday);
          if (!dayRow || !dayRow.is_working) {
            result.set(employeeId, '0.00');
            return;
          }
          const minutes = expectedMinutesForScheduleDay(dayRow);
          result.set(employeeId, (minutes / 60).toFixed(2));
        } catch (error) {
          if (error instanceof NotFoundException) {
            result.set(employeeId, '0.00');
            return;
          }
          throw error;
        }
      }),
    );

    return result;
  }
}
