import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatLocalDate } from '../workshop/workshop-planner.time';
import { HrWorkScheduleService } from '../hr/hr-work-schedule.service';
import { averageExpectedMinutesPerWorkday } from '../hr/hr-work-schedule.time';
import { PrismaService } from '../prisma/prisma.service';
import { mapEmployee, RawEmployee, toDateOnly } from './employee.helpers';

const DEFAULT_TIME_ZONE = 'Europe/Vienna';

@Injectable()
export class EmployeeLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: HrWorkScheduleService,
  ) {}

  async getCurrentLocalYear(tenantId: string): Promise<number> {
    const localDate = await this.getCurrentLocalDateString(tenantId);
    return Number(localDate.slice(0, 4));
  }

  async getCurrentLocalDate(tenantId: string): Promise<Date> {
    return toDateOnly(await this.getCurrentLocalDateString(tenantId));
  }

  async getCurrentLocalDateString(tenantId: string): Promise<string> {
    const settings = await this.prisma.site.findFirst({
      where: { tenant_id: tenantId, code: 'MAIN', is_active: true },
      select: { timezone: true },
    });
    return formatLocalDate(new Date(), settings?.timezone ?? DEFAULT_TIME_ZONE);
  }

  async attachRemaining(tenantId: string, employees: RawEmployee[]) {
    if (employees.length === 0) {
      return [];
    }

    const year = await this.getCurrentLocalYear(tenantId);
    const employeeIds = employees.map((employee) => employee.id);
    const [balances, bookedMinutes] = await Promise.all([
      this.prisma.employeeLeaveBalance.findMany({
        where: {
          tenant_id: tenantId,
          employee_id: { in: employeeIds },
          year,
        },
        select: {
          employee_id: true,
          year: true,
          allowance_minutes: true,
          carryover_minutes: true,
        },
      }),
      this.prisma.leaveRequest.groupBy({
        by: ['employee_id'],
        where: {
          tenant_id: tenantId,
          employee_id: { in: employeeIds },
          status: 'BOOKED',
          start_on: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
        _sum: { minutes_charged: true },
      }),
    ]);

    const balanceByEmployee = new Map(
      balances.map((balance) => [balance.employee_id, balance]),
    );
    const bookedMinutesByEmployee = new Map(
      bookedMinutes.map((booking) => [
        booking.employee_id,
        booking._sum.minutes_charged ?? 0,
      ]),
    );

    return employees.map((employee) => {
      const balance = balanceByEmployee.get(employee.id);
      const allowanceMinutes =
        balance?.allowance_minutes ?? employee.annual_leave_minutes;
      const carryoverMinutes = balance?.carryover_minutes ?? 0;
      const booked = bookedMinutesByEmployee.get(employee.id) ?? 0;

      return mapEmployee(employee, {
        remainingLeaveMinutes: allowanceMinutes + carryoverMinutes - booked,
        carryoverMinutes,
        leaveBalanceYear: balance?.year ?? year,
      });
    });
  }

  async seedInitialScheduleAndAllowance(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    employeeId: string,
    effectiveFrom: Date,
    requestedAnnualLeaveMinutes?: number,
  ): Promise<number> {
    const schedule = await this.scheduleService.seedInitialSchedule(
      transaction,
      tenantId,
      employeeId,
      effectiveFrom,
    );
    const avgMinutes = averageExpectedMinutesPerWorkday(schedule.days);
    return (
      requestedAnnualLeaveMinutes ??
      this.scheduleService.defaultAnnualLeaveMinutes(avgMinutes)
    );
  }

  async updateCurrentYearLeaveBalance(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    employeeId: string,
    annualLeaveMinutes: number,
  ): Promise<void> {
    const currentYear = await this.getCurrentLocalYear(tenantId);
    await transaction.employeeLeaveBalance.upsert({
      where: {
        tenant_id_employee_id_year: {
          tenant_id: tenantId,
          employee_id: employeeId,
          year: currentYear,
        },
      },
      create: {
        tenant_id: tenantId,
        employee_id: employeeId,
        year: currentYear,
        allowance_minutes: annualLeaveMinutes,
        carryover_minutes: 0,
      },
      update: { allowance_minutes: annualLeaveMinutes },
    });
  }
}
