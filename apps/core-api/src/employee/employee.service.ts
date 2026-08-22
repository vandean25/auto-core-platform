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
import {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';

const DEFAULT_ANNUAL_LEAVE_DAYS = 25;
const DEFAULT_TIME_ZONE = 'Europe/Vienna';
const TENANT_ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
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
      annual_leave_days: number;
      createdAt: Date;
      updatedAt: Date;
    },
    remainingLeaveDays = employee.annual_leave_days,
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
      annualLeaveDays: employee.annual_leave_days,
      remainingLeaveDays,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    };
  }

  async findAll(query: ListEmployeesQueryDto) {
    const where = {
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
    const employee = await this.prisma.employee.findFirst({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    return (await this.attachRemaining([employee]))[0];
  }

  async create(dto: CreateEmployeeDto) {
    this.assertTenantAdminForHrFields(dto);
    try {
      const created = await this.prisma.employee.create({
        data: {
          name: dto.name.trim(),
          role: dto.role,
          is_active: dto.isActive ?? true,
          sort_order: dto.sortOrder ?? 0,
          annual_leave_days: dto.annualLeaveDays ?? DEFAULT_ANNUAL_LEAVE_DAYS,
          ...(dto.hiredOn !== undefined && {
            hired_on: this.toDateOnly(dto.hiredOn),
          }),
          ...(dto.userId !== undefined && { user_id: dto.userId }),
          ...(dto.motherLanguageCode !== undefined && {
            mother_language_code: dto.motherLanguageCode,
          }),
        } as Prisma.EmployeeUncheckedCreateInput,
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
    const existing = await this.prisma.employee.findFirst({ where: { id } });
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
        ...(dto.annualLeaveDays !== undefined && {
          annual_leave_days: dto.annualLeaveDays,
        }),
        ...(dto.userId !== undefined && { user_id: dto.userId }),
        ...(dto.motherLanguageCode !== undefined && {
          mother_language_code: dto.motherLanguageCode,
        }),
      };

      const updated =
        dto.annualLeaveDays === undefined
          ? await this.prisma.employee.update({
              where: { id },
              data: updateData,
            })
          : await this.updateEmployeeAndCurrentLeaveBalance(
              id,
              dto.annualLeaveDays,
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
    const existing = await this.prisma.employee.findFirst({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    const [linkedOrders, attendanceEvents, leaveRequests, leaveBalances] =
      await Promise.all([
        this.prisma.workshopOrder.count({ where: { mechanic_id: id } }),
        this.prisma.attendanceEvent.count({ where: { employee_id: id } }),
        this.prisma.leaveRequest.count({ where: { employee_id: id } }),
        this.prisma.employeeLeaveBalance.count({
          where: { employee_id: id },
        }),
      ]);
    if (linkedOrders > 0) {
      throw new ConflictException(
        `Cannot delete employee with ${linkedOrders} linked workshop orders`,
      );
    }
    if (attendanceEvents > 0 || leaveRequests > 0 || leaveBalances > 0) {
      throw new ConflictException(
        'Cannot delete employee with attendance, leave, or balance records',
      );
    }

    if (existing.is_active) {
      const updated = await this.prisma.employee.update({
        where: { id },
        data: { is_active: false },
      });
      return { id: updated.id, isActive: updated.is_active };
    }

    await this.prisma.employee.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async attachRemaining(
    employees: Awaited<ReturnType<PrismaService['employee']['findMany']>>,
  ) {
    if (employees.length === 0) {
      return [];
    }

    const year = await this.getCurrentLocalYear();
    const employeeIds = employees.map((employee) => employee.id);
    const [balances, bookedDays] = await Promise.all([
      this.prisma.employeeLeaveBalance.findMany({
        where: {
          employee_id: { in: employeeIds },
          year,
        },
        select: {
          employee_id: true,
          allowance_days: true,
          carryover_days: true,
        },
      }),
      this.prisma.leaveRequest.groupBy({
        by: ['employee_id'],
        where: {
          employee_id: { in: employeeIds },
          status: 'BOOKED',
          start_on: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
        _sum: { days_charged: true },
      }),
    ]);

    const balanceByEmployee = new Map(
      balances.map((balance) => [balance.employee_id, balance]),
    );
    const bookedDaysByEmployee = new Map(
      bookedDays.map((booking) => [
        booking.employee_id,
        booking._sum.days_charged ?? 0,
      ]),
    );

    return employees.map((employee) => {
      const balance = balanceByEmployee.get(employee.id);
      const allowanceDays =
        balance?.allowance_days ?? employee.annual_leave_days;
      const carryoverDays = balance?.carryover_days ?? 0;
      const booked = bookedDaysByEmployee.get(employee.id) ?? 0;

      return this.mapEmployee(employee, allowanceDays + carryoverDays - booked);
    });
  }

  private async getCurrentLocalYear(): Promise<number> {
    const settings = await this.prisma.workshopSettings.findFirst({
      select: { timezone: true },
    });
    const localDate = formatLocalDate(
      new Date(),
      settings?.timezone ?? DEFAULT_TIME_ZONE,
    );
    return Number(localDate.slice(0, 4));
  }

  private async updateEmployeeAndCurrentLeaveBalance(
    id: string,
    annualLeaveDays: number,
    updateData: Prisma.EmployeeUpdateInput,
  ) {
    const currentYear = await this.getCurrentLocalYear();
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.employee.update({
        where: { id },
        data: updateData,
      });
      await transaction.employeeLeaveBalance.updateMany({
        where: { employee_id: id, year: currentYear },
        data: { allowance_days: annualLeaveDays },
      });
      return updated;
    });
  }

  private assertTenantAdminForHrFields(
    dto: CreateEmployeeDto | UpdateEmployeeDto,
  ): void {
    const includesHrFields =
      dto.hiredOn !== undefined || dto.annualLeaveDays !== undefined;
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
