import { LeaveRequestStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  formatLocalDate,
  isoWeekdayFromUtcDate,
  parseLocalDate,
} from '../workshop/workshop-planner.time.js';
import type { WorkshopSettingsService } from '../workshop/workshop-settings.service.js';
import { deriveAttendanceState } from './hr-attendance.service.js';
import type { HrWorkScheduleService } from './hr-work-schedule.service.js';
import { expectedMinutesForScheduleDay } from './hr-work-schedule.time.js';
import { NotFoundException } from '@nestjs/common';

export async function loadOnLeaveEmployeeIds(
  prisma: PrismaService,
  tenantId: string,
  employeeIds: string[],
  date: string,
): Promise<Set<string>> {
  const target = new Date(`${date}T00:00:00.000Z`);
  const rows = await prisma.leaveRequest.findMany({
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

export async function loadPresentNowEmployeeIds(
  prisma: PrismaService,
  tenantId: string,
  employeeIds: string[],
): Promise<Set<string>> {
  const events = await prisma.attendanceEvent.findMany({
    where: {
      tenant_id: tenantId,
      employee_id: { in: employeeIds },
    },
    orderBy: [{ occurred_at: 'desc' }, { createdAt: 'desc' }],
    select: {
      employee_id: true,
      type: true,
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

export async function loadScheduledHoursForDate(
  workSchedule: HrWorkScheduleService,
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
        const schedule = await workSchedule.resolveScheduleForDate(
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

export async function resolveStaffAvailabilityDate(
  workshopSettings: WorkshopSettingsService,
  tenantId: string,
  siteId: string,
  date?: string,
): Promise<string> {
  const settings = await workshopSettings.getSettingsForSite(tenantId, siteId);
  const resolved = date ?? formatLocalDate(new Date(), settings.timezone);
  parseLocalDate(resolved);
  return resolved;
}
