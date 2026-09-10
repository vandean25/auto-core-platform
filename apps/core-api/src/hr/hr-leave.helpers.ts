import { BadRequestException } from '@nestjs/common';
import type {
  EmployeeRole,
  LeaveRequest,
  LeaveRequestStatus,
} from '@prisma/client';
import type { LeaveRequestResponseDto } from './dto/hr-leave.dto';

export interface ValidatedDateRange {
  startOnStr: string;
  endOnStr: string;
  year: number;
  startOnDate: Date;
  endOnDate: Date;
}

export interface CreateLeaveBookingInput {
  tenantId: string;
  employeeId: string;
  annualLeaveMinutes: number;
  startOnStr: string;
  endOnStr: string;
  note?: string;
  createdByUserId?: string | null;
}

export interface LeaveBalanceAdjustmentInput {
  tenantId: string;
  employeeId: string;
  year: number;
  currentYear: number;
  allowanceMinutes?: number;
  carryoverMinutes?: number;
  defaultAllowanceMinutes: number;
}

export function toUtcDateOnly(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new BadRequestException('Date must be formatted as YYYY-MM-DD');
  }
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
}

export function formatUtcDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function validateDateRange(
  startOnStr: string,
  endOnStr: string,
): ValidatedDateRange {
  if (endOnStr < startOnStr) {
    throw new BadRequestException('endOn must be on or after startOn');
  }

  const startYear = startOnStr.slice(0, 4);
  const endYear = endOnStr.slice(0, 4);
  if (startYear !== endYear) {
    throw new BadRequestException(
      'Leave booking cannot span two calendar years',
    );
  }

  return {
    startOnStr,
    endOnStr,
    year: Number(startYear),
    startOnDate: toUtcDateOnly(startOnStr),
    endOnDate: toUtcDateOnly(endOnStr),
  };
}

export function validateLeaveTransition(
  currentStatus: LeaveRequestStatus,
  action: 'update' | 'cancel' = 'update',
): void {
  if (currentStatus === 'CANCELLED' && action === 'update') {
    throw new BadRequestException('Cannot edit a cancelled leave request');
  }
}

export function calculateRemainingLeaveMinutes(
  allowanceMinutes: number,
  carryoverMinutes: number,
  bookedMinutes: number,
): number {
  return allowanceMinutes + carryoverMinutes - bookedMinutes;
}

export function toLeaveRequestDto(
  booking: LeaveRequest & {
    employee?: { id: string; name: string; role: EmployeeRole };
  },
): LeaveRequestResponseDto {
  return {
    id: booking.id,
    employeeId: booking.employee_id,
    startOn: formatUtcDateOnly(booking.start_on),
    endOn: formatUtcDateOnly(booking.end_on),
    status: booking.status,
    minutesCharged: booking.minutes_charged,
    note: booking.note,
    createdByUserId: booking.created_by_user_id,
    ...(booking.employee && {
      employee: {
        id: booking.employee.id,
        name: booking.employee.name,
        role: booking.employee.role,
      },
    }),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}
