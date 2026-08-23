import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeRole,
  LeaveRequest,
  LeaveRequestStatus,
  Prisma,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatLocalDate } from '../workshop/workshop-planner.time';
import {
  CreateEmployeeLeaveDto,
  CreateMyLeaveDto,
  LeaveBalanceResponseDto,
  LeaveRequestResponseDto,
  MyLeaveResponseDto,
  PatchLeaveBalanceDto,
  QueryHrLeaveDto,
  UpdateLeaveRequestDto,
} from './dto/hr-leave.dto';
import { HrIdentityService } from './hr-identity.service';
import { HrWorkdayService } from './hr-workday.service';

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

@Injectable()
export class HrLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly identityService: HrIdentityService,
    private readonly workdayService: HrWorkdayService,
  ) {}

  async getMyLeave(queryYear?: number): Promise<MyLeaveResponseDto> {
    const me = await this.identityService.resolveMe();
    const tenantId = await this.tenantContext.getTenantId();
    const calendar = await this.workdayService.loadTenantCalendar(tenantId);
    const year =
      queryYear ??
      Number(formatLocalDate(new Date(), calendar.timezone).slice(0, 4));

    const balance = await this.getOrUpsertBalance(
      tenantId,
      me.id,
      year,
      me.annual_leave_days,
    );

    const startOfYear = new Date(Date.UTC(year, 0, 1));
    const startOfNextYear = new Date(Date.UTC(year + 1, 0, 1));

    const bookings = await this.prisma.leaveRequest.findMany({
      where: {
        tenant_id: tenantId,
        employee_id: me.id,
        start_on: {
          gte: startOfYear,
          lt: startOfNextYear,
        },
      },
      orderBy: [{ start_on: 'asc' }],
    });

    const bookedDays = bookings
      .filter((b) => b.status === LeaveRequestStatus.BOOKED)
      .reduce((acc, curr) => acc + curr.days_charged, 0);

    const allowanceDays = balance.allowance_days;
    const carryoverDays = balance.carryover_days;
    const remainingDays = allowanceDays + carryoverDays - bookedDays;

    return {
      year,
      allowanceDays,
      carryoverDays,
      remainingDays,
      bookings: bookings.map((b) => this.toDto(b)),
    };
  }

  async createMyLeave(dto: CreateMyLeaveDto): Promise<LeaveRequestResponseDto> {
    const me = await this.identityService.resolveMe();
    const tenantId = await this.tenantContext.getTenantId();
    const createdByUserId = await this.resolvePostgresUserId();

    return this.createLeaveBooking(
      tenantId,
      me.id,
      me.annual_leave_days,
      dto.startOn,
      dto.endOn,
      dto.note,
      createdByUserId,
    );
  }

  async createEmployeeLeave(
    dto: CreateEmployeeLeaveDto,
  ): Promise<LeaveRequestResponseDto> {
    this.identityService.assertOwnerAdmin();
    const tenantId = await this.tenantContext.getTenantId();

    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenant_id: tenantId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${dto.employeeId} not found`);
    }

    const createdByUserId = await this.resolvePostgresUserId();

    return this.createLeaveBooking(
      tenantId,
      employee.id,
      employee.annual_leave_days,
      dto.startOn,
      dto.endOn,
      dto.note,
      createdByUserId,
    );
  }

  async cancelLeave(id: string): Promise<LeaveRequestResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const booking = await this.prisma.leaveRequest.findFirst({
      where: { id, tenant_id: tenantId },
      include: { employee: true },
    });
    if (!booking) {
      throw new NotFoundException(`Leave request ${id} not found`);
    }

    if (booking.status === LeaveRequestStatus.CANCELLED) {
      return this.toDto(booking);
    }

    const user = this.tenantContext.getAuthenticatedUser();
    const isOwnerOrAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';

    if (!isOwnerOrAdmin) {
      const me = await this.identityService.resolveMe();
      if (booking.employee_id !== me.id) {
        throw new ForbiddenException(
          'Cannot cancel leave request of another employee',
        );
      }

      const calendar = await this.workdayService.loadTenantCalendar(tenantId);
      const todayStr = formatLocalDate(new Date(), calendar.timezone);
      const bookingStartStr = formatUtcDateOnly(booking.start_on);

      if (bookingStartStr < todayStr) {
        throw new ForbiddenException('Cannot cancel past leave');
      }
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id: booking.id },
      data: { status: LeaveRequestStatus.CANCELLED },
      include: { employee: true },
    });

    return this.toDto(updated);
  }

  async listTeamLeave(
    query: QueryHrLeaveDto,
  ): Promise<LeaveRequestResponseDto[]> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (user?.role === 'TECH') {
      throw new ForbiddenException('Tech role cannot view team leave');
    }

    const tenantId = await this.tenantContext.getTenantId();
    const where: Prisma.LeaveRequestWhereInput = {
      tenant_id: tenantId,
    };

    if (query.employeeId) {
      where.employee_id = query.employeeId;
    }

    if (query.from && query.to) {
      where.start_on = { lte: toUtcDateOnly(query.to) };
      where.end_on = { gte: toUtcDateOnly(query.from) };
    } else if (query.from) {
      where.end_on = { gte: toUtcDateOnly(query.from) };
    } else if (query.to) {
      where.start_on = { lte: toUtcDateOnly(query.to) };
    }

    const rows = await this.prisma.leaveRequest.findMany({
      where,
      orderBy: [{ start_on: 'asc' }],
      include: {
        employee: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    return rows.map((row) => this.toDto(row));
  }

  async updateLeave(
    id: string,
    dto: UpdateLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto> {
    this.identityService.assertOwnerAdmin();
    const tenantId = await this.tenantContext.getTenantId();

    const existing = await this.prisma.leaveRequest.findFirst({
      where: { id, tenant_id: tenantId },
      include: { employee: true },
    });
    if (!existing) {
      throw new NotFoundException(`Leave request ${id} not found`);
    }

    if (existing.status === LeaveRequestStatus.CANCELLED) {
      throw new BadRequestException('Cannot edit a cancelled leave request');
    }

    const startOnStr = dto.startOn ?? formatUtcDateOnly(existing.start_on);
    const endOnStr = dto.endOn ?? formatUtcDateOnly(existing.end_on);

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
    const year = Number(startYear);

    const calendar = await this.workdayService.loadTenantCalendar(tenantId);
    const daysCharged = this.workdayService.countChargeableDays(
      startOnStr,
      endOnStr,
      calendar.timezone,
      calendar.openingHours,
      calendar.holidays,
    );

    if (daysCharged === 0) {
      throw new BadRequestException('Leave range contains zero workdays');
    }

    const startOnDate = toUtcDateOnly(startOnStr);
    const endOnDate = toUtcDateOnly(endOnStr);

    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        tenant_id: tenantId,
        employee_id: existing.employee_id,
        status: LeaveRequestStatus.BOOKED,
        id: { not: existing.id },
        start_on: { lte: endOnDate },
        end_on: { gte: startOnDate },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        'Leave booking overlaps with an existing booking',
      );
    }

    const balance = await this.getOrUpsertBalance(
      tenantId,
      existing.employee_id,
      year,
      existing.employee.annual_leave_days,
    );

    const otherBookings = await this.prisma.leaveRequest.aggregate({
      where: {
        tenant_id: tenantId,
        employee_id: existing.employee_id,
        status: LeaveRequestStatus.BOOKED,
        id: { not: existing.id },
        start_on: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      _sum: { days_charged: true },
    });

    const otherCharged = otherBookings._sum.days_charged ?? 0;
    const remainingAvailable =
      balance.allowance_days + balance.carryover_days - otherCharged;

    if (daysCharged > remainingAvailable) {
      throw new ConflictException('Not enough remaining leave days');
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id: existing.id },
      data: {
        start_on: startOnDate,
        end_on: endOnDate,
        days_charged: daysCharged,
        ...(dto.note !== undefined && { note: dto.note?.trim() || null }),
      },
      include: {
        employee: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    return this.toDto(updated);
  }

  async patchLeaveBalance(
    employeeId: string,
    dto: PatchLeaveBalanceDto,
  ): Promise<LeaveBalanceResponseDto> {
    this.identityService.assertOwnerAdmin();
    const tenantId = await this.tenantContext.getTenantId();

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenant_id: tenantId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }

    const calendar = await this.workdayService.loadTenantCalendar(tenantId);
    const currentYear = Number(
      formatLocalDate(new Date(), calendar.timezone).slice(0, 4),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const balance = await tx.employeeLeaveBalance.upsert({
        where: {
          tenant_id_employee_id_year: {
            tenant_id: tenantId,
            employee_id: employeeId,
            year: dto.year,
          },
        },
        create: {
          tenant_id: tenantId,
          employee_id: employeeId,
          year: dto.year,
          allowance_days: dto.allowanceDays ?? employee.annual_leave_days,
          carryover_days: dto.carryoverDays ?? 0,
        },
        update: {
          ...(dto.allowanceDays !== undefined && {
            allowance_days: dto.allowanceDays,
          }),
          ...(dto.carryoverDays !== undefined && {
            carryover_days: dto.carryoverDays,
          }),
        },
      });

      if (dto.year === currentYear && dto.allowanceDays !== undefined) {
        const updatedEmployee = await tx.employee.updateMany({
          where: { id: employeeId, tenant_id: tenantId },
          data: { annual_leave_days: dto.allowanceDays },
        });
        if (updatedEmployee.count === 0) {
          throw new NotFoundException(`Employee ${employeeId} not found`);
        }
      }

      return balance;
    });

    return {
      id: result.id,
      employeeId: result.employee_id,
      year: result.year,
      allowanceDays: result.allowance_days,
      carryoverDays: result.carryover_days,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  private async createLeaveBooking(
    tenantId: string,
    employeeId: string,
    annualLeaveDays: number,
    startOnStr: string,
    endOnStr: string,
    note?: string,
    createdByUserId?: string | null,
  ): Promise<LeaveRequestResponseDto> {
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
    const year = Number(startYear);

    const calendar = await this.workdayService.loadTenantCalendar(tenantId);
    const daysCharged = this.workdayService.countChargeableDays(
      startOnStr,
      endOnStr,
      calendar.timezone,
      calendar.openingHours,
      calendar.holidays,
    );

    if (daysCharged === 0) {
      throw new BadRequestException('Leave range contains zero workdays');
    }

    const startOnDate = toUtcDateOnly(startOnStr);
    const endOnDate = toUtcDateOnly(endOnStr);

    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        tenant_id: tenantId,
        employee_id: employeeId,
        status: LeaveRequestStatus.BOOKED,
        start_on: { lte: endOnDate },
        end_on: { gte: startOnDate },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        'Leave booking overlaps with an existing booking',
      );
    }

    const balance = await this.getOrUpsertBalance(
      tenantId,
      employeeId,
      year,
      annualLeaveDays,
    );

    const existingBookings = await this.prisma.leaveRequest.aggregate({
      where: {
        tenant_id: tenantId,
        employee_id: employeeId,
        status: LeaveRequestStatus.BOOKED,
        start_on: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      _sum: { days_charged: true },
    });

    const alreadyBooked = existingBookings._sum.days_charged ?? 0;
    const remainingDays =
      balance.allowance_days + balance.carryover_days - alreadyBooked;

    if (daysCharged > remainingDays) {
      throw new ConflictException('Not enough remaining leave days');
    }

    const created = await this.prisma.leaveRequest.create({
      data: {
        tenant_id: tenantId,
        employee_id: employeeId,
        start_on: startOnDate,
        end_on: endOnDate,
        status: LeaveRequestStatus.BOOKED,
        days_charged: daysCharged,
        note: note?.trim() || null,
        created_by_user_id: createdByUserId,
      },
      include: {
        employee: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    return this.toDto(created);
  }

  private async getOrUpsertBalance(
    tenantId: string,
    employeeId: string,
    year: number,
    defaultAllowance: number,
  ) {
    return this.prisma.employeeLeaveBalance.upsert({
      where: {
        tenant_id_employee_id_year: {
          tenant_id: tenantId,
          employee_id: employeeId,
          year,
        },
      },
      create: {
        tenant_id: tenantId,
        employee_id: employeeId,
        year,
        allowance_days: defaultAllowance,
        carryover_days: 0,
      },
      update: {},
    });
  }

  private async resolvePostgresUserId(): Promise<string | null> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.userId && !user?.email) {
      return null;
    }

    const dbUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(user.userId ? [{ firebaseUid: user.userId }] : []),
          ...(user.email ? [{ email: user.email }] : []),
        ],
      },
      select: { id: true },
    });

    return dbUser?.id ?? null;
  }

  private toDto(
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
      daysCharged: booking.days_charged,
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
}
