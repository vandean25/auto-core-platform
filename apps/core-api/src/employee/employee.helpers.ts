import { ConflictException } from '@nestjs/common';
import { EmployeeRole, Prisma } from '@prisma/client';
import { UpdateEmployeeDto } from './dto/employee.dto';

export type EmployeeLeaveSummary = {
  remainingLeaveMinutes: number;
  carryoverMinutes: number;
  leaveBalanceYear: number;
};

export type RawEmployee = {
  id: string;
  name: string;
  role: EmployeeRole;
  is_active: boolean;
  sort_order: number;
  user_id?: string | null;
  mother_language_code?: string | null;
  hired_on: Date | null;
  annual_leave_minutes: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toDateOnly(value: string): Date;
export function toDateOnly(value: null | undefined): null;
export function toDateOnly(value: string | null | undefined): Date | null;
export function toDateOnly(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export function handleEmployeeConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new ConflictException(
      'This user account is already linked to another employee in this tenant.',
    );
  }
  throw error;
}

export function buildEmployeeUpdateData(
  dto: UpdateEmployeeDto,
): Prisma.EmployeeUncheckedUpdateManyInput {
  return {
    ...(dto.name !== undefined && { name: dto.name.trim() }),
    ...(dto.role !== undefined && { role: dto.role }),
    ...(dto.isActive !== undefined && { is_active: dto.isActive }),
    ...(dto.sortOrder !== undefined && { sort_order: dto.sortOrder }),
    ...(dto.hiredOn !== undefined && {
      hired_on: toDateOnly(dto.hiredOn),
    }),
    ...(dto.annualLeaveMinutes !== undefined && {
      annual_leave_minutes: dto.annualLeaveMinutes,
    }),
    ...(dto.userId !== undefined && { user_id: dto.userId }),
    ...(dto.motherLanguageCode !== undefined && {
      mother_language_code: dto.motherLanguageCode,
    }),
  };
}

export function mapEmployee(
  employee: RawEmployee,
  leaveSummary: EmployeeLeaveSummary,
) {
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    isActive: employee.is_active,
    sortOrder: employee.sort_order,
    userId: employee.user_id ?? null,
    motherLanguageCode: employee.mother_language_code ?? null,
    hiredOn: employee.hired_on
      ? employee.hired_on.toISOString().slice(0, 10)
      : null,
    annualLeaveMinutes: employee.annual_leave_minutes,
    carryoverMinutes: leaveSummary.carryoverMinutes,
    leaveBalanceYear: leaveSummary.leaveBalanceYear,
    remainingLeaveMinutes: leaveSummary.remainingLeaveMinutes,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}
