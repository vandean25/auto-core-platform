import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeRole, Prisma } from '@prisma/client';
import { formatLocalDate } from '../workshop/workshop-planner.time';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { HrWorkScheduleService } from '../hr/hr-work-schedule.service';
import { averageExpectedMinutesPerWorkday } from '../hr/hr-work-schedule.time';
import {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';

const DEFAULT_TIME_ZONE = 'Europe/Vienna';
const TENANT_ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

type EmployeeLeaveSummary = {
  remainingLeaveMinutes: number;
  carryoverMinutes: number;
  leaveBalanceYear: number;
};

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly scheduleService: HrWorkScheduleService,
  ) {}

  private mapEmployee(
    employee: {
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
    },
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

  async findAll(query: ListEmployeesQueryDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const where = {
      tenant_id: tenantId,
      ...(query.includeInactive ? {} : { is_active: true }),
      ...(query.role ? { role: query.role } : {}),
    };

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const [employees, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data: await this.attachRemaining(employees),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const employee = await this.prisma.employee.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    return (await this.attachRemaining([employee]))[0];
  }

  async create(dto: CreateEmployeeDto) {
    const tenantId = await this.tenantContext.getTenantId();
    this.assertTenantAdminForHrFields(dto);
    try {
      const hiredOn =
        dto.hiredOn !== undefined ? this.toDateOnly(dto.hiredOn) : null;
      const effectiveFrom = hiredOn ?? (await this.getCurrentLocalDate());

      const created = await this.prisma.$transaction(async (transaction) => {
        const employee = await transaction.employee.create({
          data: {
            tenant_id: tenantId,
            name: dto.name.trim(),
            role: dto.role,
            is_active: dto.isActive ?? true,
            sort_order: dto.sortOrder ?? 0,
            annual_leave_minutes: 0,
            hired_on: hiredOn,
            ...(dto.userId !== undefined && { user_id: dto.userId }),
            ...(dto.motherLanguageCode !== undefined && {
              mother_language_code: dto.motherLanguageCode,
            }),
          },
        });

        const schedule = await this.scheduleService.seedInitialSchedule(
          transaction,
          tenantId,
          employee.id,
          effectiveFrom,
        );
        const avgMinutes = averageExpectedMinutesPerWorkday(schedule.days);
        const annualLeaveMinutes =
          dto.annualLeaveMinutes ??
          this.scheduleService.defaultAnnualLeaveMinutes(avgMinutes);

        return transaction.employee.update({
          where: {
            tenant_id_id: {
              tenant_id: tenantId,
              id: employee.id,
            },
          },
          data: { annual_leave_minutes: annualLeaveMinutes },
        });
      });

      return (await this.attachRemaining([created]))[0];
    } catch (error) {
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
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.employee.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    this.assertTenantAdminForHrFields(dto);

    try {
      const updateData = {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sort_order: dto.sortOrder }),
        ...(dto.hiredOn !== undefined && {
          hired_on: this.toDateOnly(dto.hiredOn),
        }),
        ...(dto.annualLeaveMinutes !== undefined && {
          annual_leave_minutes: dto.annualLeaveMinutes,
        }),
        ...(dto.userId !== undefined && { user_id: dto.userId }),
        ...(dto.motherLanguageCode !== undefined && {
          mother_language_code: dto.motherLanguageCode,
        }),
      };

      const updated =
        dto.annualLeaveMinutes === undefined
          ? await this.updateEmployee(id, tenantId, updateData)
          : await this.updateEmployeeAndCurrentLeaveBalance(
              id,
              tenantId,
              dto.annualLeaveMinutes,
              updateData,
            );

      return (await this.attachRemaining([updated]))[0];
    } catch (error) {
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
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.employee.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    const linkedOrders = await this.prisma.workshopOrder.count({
      where: { tenant_id: tenantId, mechanic_id: id },
    });
    if (linkedOrders > 0) {
      throw new ConflictException(
        `Cannot delete employee with ${linkedOrders} linked workshop orders`,
      );
    }

    if (existing.is_active) {
      const updated = await this.prisma.employee.updateMany({
        where: { id, tenant_id: tenantId },
        data: { is_active: false },
      });
      if (updated.count === 0) {
        throw new NotFoundException(`Employee with ID ${id} not found`);
      }
      return { id, isActive: false };
    }

    const [
      linkedTasks,
      linkedMedia,
      linkedVoiceNotes,
      linkedLaborEntries,
      attendanceEvents,
      leaveRequests,
      leaveBalances,
    ] = await Promise.all([
      this.prisma.workshopTask.count({
        where: { tenant_id: tenantId, mechanic_id: id },
      }),
      this.prisma.workshopMedia.count({
        where: { tenant_id: tenantId, uploaded_by_employee_id: id },
      }),
      this.prisma.workshopVoiceNoteDraft.count({
        where: { tenant_id: tenantId, mechanic_employee_id: id },
      }),
      this.prisma.laborEntry.count({
        where: { tenant_id: tenantId, employee_id: id },
      }),
      this.prisma.attendanceEvent.count({
        where: { tenant_id: tenantId, employee_id: id },
      }),
      this.prisma.leaveRequest.count({
        where: { tenant_id: tenantId, employee_id: id },
      }),
      this.prisma.employeeLeaveBalance.count({
        where: { tenant_id: tenantId, employee_id: id },
      }),
    ]);
    if (
      linkedTasks > 0 ||
      linkedMedia > 0 ||
      linkedVoiceNotes > 0 ||
      linkedLaborEntries > 0
    ) {
      throw new ConflictException(
        'Cannot delete employee with linked work records',
      );
    }
    if (attendanceEvents > 0 || leaveRequests > 0 || leaveBalances > 0) {
      throw new ConflictException(
        'Cannot delete employee with attendance, leave, or balance records',
      );
    }

    try {
      const deleted = await this.prisma.employee.deleteMany({
        where: { id, tenant_id: tenantId },
      });
      if (deleted.count === 0) {
        throw new NotFoundException(`Employee with ID ${id} not found`);
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot delete employee because linked records were created concurrently',
        );
      }
      throw error;
    }
    return { id, deleted: true };
  }

  private async attachRemaining(
    employees: Awaited<ReturnType<PrismaService['employee']['findMany']>>,
  ) {
    if (employees.length === 0) {
      return [];
    }

    const tenantId = await this.tenantContext.getTenantId();
    const year = await this.getCurrentLocalYear();
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

      return this.mapEmployee(employee, {
        remainingLeaveMinutes: allowanceMinutes + carryoverMinutes - booked,
        carryoverMinutes,
        leaveBalanceYear: balance?.year ?? year,
      });
    });
  }

  private async getCurrentLocalYear(): Promise<number> {
    const localDate = await this.getCurrentLocalDateString();
    return Number(localDate.slice(0, 4));
  }

  private async getCurrentLocalDate(): Promise<Date> {
    return this.toDateOnly(await this.getCurrentLocalDateString())!;
  }

  private async getCurrentLocalDateString(): Promise<string> {
    const tenantId = await this.tenantContext.getTenantId();
    const settings = await this.prisma.workshopSettings.findFirst({
      where: { tenant_id: tenantId },
      select: { timezone: true },
    });
    return formatLocalDate(
      new Date(),
      settings?.timezone ?? DEFAULT_TIME_ZONE,
    );
  }

  private async updateEmployeeAndCurrentLeaveBalance(
    id: string,
    tenantId: string,
    annualLeaveMinutes: number,
    updateData: Prisma.EmployeeUncheckedUpdateManyInput,
  ) {
    const currentYear = await this.getCurrentLocalYear();
    return this.prisma.$transaction(async (transaction) => {
      const employeeUpdate = await transaction.employee.updateMany({
        where: { id, tenant_id: tenantId },
        data: updateData,
      });
      if (employeeUpdate.count === 0) {
        throw new NotFoundException(`Employee with ID ${id} not found`);
      }

      await transaction.employeeLeaveBalance.upsert({
        where: {
          tenant_id_employee_id_year: {
            tenant_id: tenantId,
            employee_id: id,
            year: currentYear,
          },
        },
        create: {
          tenant_id: tenantId,
          employee_id: id,
          year: currentYear,
          allowance_minutes: annualLeaveMinutes,
          carryover_minutes: 0,
        },
        update: { allowance_minutes: annualLeaveMinutes },
      });

      const updated = await transaction.employee.findFirst({
        where: { id, tenant_id: tenantId },
      });
      if (!updated) {
        throw new NotFoundException(`Employee with ID ${id} not found`);
      }
      return updated;
    });
  }

  private async updateEmployee(
    id: string,
    tenantId: string,
    updateData: Prisma.EmployeeUncheckedUpdateManyInput,
  ) {
    const updated = await this.prisma.employee.updateMany({
      where: { id, tenant_id: tenantId },
      data: updateData,
    });
    if (updated.count === 0) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    return employee;
  }

  private assertTenantAdminForHrFields(
    dto: CreateEmployeeDto | UpdateEmployeeDto,
  ): void {
    const includesHrFields =
      dto.hiredOn !== undefined || dto.annualLeaveMinutes !== undefined;
    if (!includesHrFields) {
      return;
    }

    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (!role || !TENANT_ADMIN_ROLES.has(role)) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }

  private toDateOnly(value: string | null): Date | null {
    return value === null ? null : new Date(`${value}T00:00:00.000Z`);
  }
}
