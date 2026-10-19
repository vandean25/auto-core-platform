import { NotFoundException } from '@nestjs/common';
import type { EmployeeRole } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import type { WorkshopSettingsService } from '../workshop/workshop-settings.service.js';
import { assertMcpStaffAvailabilityAccess } from './hr-staff-availability.access.js';
import {
  loadOnLeaveEmployeeIds,
  loadPresentNowEmployeeIds,
  loadScheduledHoursForDate,
  resolveStaffAvailabilityDate,
} from './hr-staff-availability.loaders.js';
import type { HrWorkScheduleService } from './hr-work-schedule.service.js';
import type {
  StaffAvailabilityEmployeeRow,
  StaffAvailabilityQuery,
} from './hr-staff-availability.service.js';

export async function runGetStaffAvailability(
  deps: {
    prisma: PrismaService;
    tenantContext: TenantContextService;
    siteContext: SiteContextService;
    workSchedule: HrWorkScheduleService;
    workshopSettings: WorkshopSettingsService;
  },
  query: StaffAvailabilityQuery,
): Promise<{
  date: string;
  site_id: string;
  employees: StaffAvailabilityEmployeeRow[];
}> {
  assertMcpStaffAvailabilityAccess(deps.tenantContext);
  const tenantId = await deps.tenantContext.getTenantId();
  const siteId = query.siteId ?? (await deps.siteContext.getSiteId());
  await assertSiteAuthorized(deps.siteContext, siteId);

  const date = await resolveStaffAvailabilityDate(
    deps.workshopSettings,
    tenantId,
    siteId,
    query.date,
  );

  const employees = await deps.prisma.employee.findMany({
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
    loadOnLeaveEmployeeIds(deps.prisma, tenantId, employeeIds, date),
    loadPresentNowEmployeeIds(deps.prisma, tenantId, employeeIds),
    loadScheduledHoursForDate(deps.workSchedule, tenantId, employeeIds, date),
  ]);

  return {
    date,
    site_id: siteId,
    employees: employees.map((employee) => ({
      employee_id: employee.id,
      display_name: employee.name,
      role: employee.role as EmployeeRole,
      present_now: presentIds.has(employee.id),
      scheduled_hours: scheduledHours.get(employee.id) ?? '0.00',
      on_leave: onLeaveIds.has(employee.id),
    })),
  };
}

async function assertSiteAuthorized(
  siteContext: SiteContextService,
  siteId: string,
): Promise<void> {
  const allowed = await siteContext.listAuthorizedSiteIds();
  if (!allowed.includes(siteId)) {
    throw new NotFoundException(`Site ${siteId} not found`);
  }
}
