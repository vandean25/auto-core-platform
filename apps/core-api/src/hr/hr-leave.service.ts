import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaveRequestStatus, type Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatLocalDate } from '../workshop/workshop-planner.time';
import type {
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
import type {
  CreateLeaveBookingInput,
  LeaveBalanceAdjustmentInput,
  ValidatedDateRange,
} from './hr-leave.helpers';
import {
  calculateRemainingLeaveMinutes,
  formatUtcDateOnly,
  toLeaveRequestDto,
  toUtcDateOnly,
  validateDateRange,
  validateLeaveTransition,
} from './hr-leave.helpers';
import { HrWorkdayService } from './hr-workday.service';

export { formatUtcDateOnly, toUtcDateOnly };
export type { CreateLeaveBookingInput, ValidatedDateRange };

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
      me.annual_leave_minutes,
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

    const bookedMinutes = bookings
      .filter((b) => b.status === LeaveRequestStatus.BOOKED)
      .reduce((acc, curr) => acc + curr.minutes_charged, 0);

    const allowanceMinutes = balance.allowance_minutes;
    const carryoverMinutes = balance.carryover_minutes;
    const remainingMinutes = calculateRemainingLeaveMinutes(
      allowanceMinutes,
      carryoverMinutes,
      bookedMinutes,
    );

    return {
      year,
      allowanceMinutes,
      carryoverMinutes,
      remainingMinutes,
      bookings: bookings.map((b) => toLeaveRequestDto(b)),
    };
  }

  async createMyLeave(dto: CreateMyLeaveDto): Promise<LeaveRequestResponseDto> {
    const me = await this.identityService.resolveMe();
    const tenantId = await this.tenantContext.getTenantId();
    const createdByUserId = await this.resolvePostgresUserId();

    return this.createLeaveBooking({
      tenantId,
      employeeId: me.id,
      annualLeaveMinutes: me.annual_leave_minutes,
      startOnStr: dto.startOn,
      endOnStr: dto.endOn,
      note: dto.note,
      createdByUserId,
    });
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

    return this.createLeaveBooking({
      tenantId,
      employeeId: employee.id,
      annualLeaveMinutes: employee.annual_leave_minutes,
      startOnStr: dto.startOn,
      endOnStr: dto.endOn,
      note: dto.note,
      createdByUserId,
    });
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
      return toLeaveRequestDto(booking);
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
      where: {
        tenant_id_id: {
          tenant_id: tenantId,
          id: booking.id,
        },
      },
      data: { status: LeaveRequestStatus.CANCELLED },
      include: { employee: true },
    });

    return toLeaveRequestDto(updated);
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

    return rows.map((row) => toLeaveRequestDto(row));
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

    validateLeaveTransition(existing.status, 'update');

    const startOnStr = dto.startOn ?? formatUtcDateOnly(existing.start_on);
    const endOnStr = dto.endOn ?? formatUtcDateOnly(existing.end_on);

    const range = validateDateRange(startOnStr, endOnStr);

    const minutesCharged = await this.computeChargeableMinutes(
      tenantId,
      existing.employee_id,
      range,
    );

    await this.assertNoOverlap(
      tenantId,
      existing.employee_id,
      range,
      existing.id,
    );

    const balance = await this.getOrUpsertBalance(
      tenantId,
      existing.employee_id,
      range.year,
      existing.employee.annual_leave_minutes,
    );

    await this.assertSufficientBalance(
      tenantId,
      existing.employee_id,
      range.year,
      balance,
      minutesCharged,
      existing.id,
    );

    const updated = await this.executeLeaveUpdate(
      tenantId,
      existing.id,
      range,
      minutesCharged,
      dto.note,
    );

    return toLeaveRequestDto(updated);
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

    const result = await this.applyLeaveBalanceAdjustment({
      tenantId,
      employeeId,
      year: dto.year,
      currentYear,
      allowanceMinutes: dto.allowanceMinutes,
      carryoverMinutes: dto.carryoverMinutes,
      defaultAllowanceMinutes: employee.annual_leave_minutes,
    });

    return {
      id: result.id,
      employeeId: result.employee_id,
      year: result.year,
      allowanceMinutes: result.allowance_minutes,
      carryoverMinutes: result.carryover_minutes,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async applyLeaveBalanceAdjustment(
    input: LeaveBalanceAdjustmentInput,
  ) {
    const {
      tenantId,
      employeeId,
      year,
      currentYear,
      allowanceMinutes,
      carryoverMinutes,
      defaultAllowanceMinutes,
    } = input;

    return this.prisma.$transaction(async (tx) => {
      const balance = await tx.employeeLeaveBalance.upsert({
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
          allowance_minutes: allowanceMinutes ?? defaultAllowanceMinutes,
          carryover_minutes: carryoverMinutes ?? 0,
        },
        update: {
          ...(allowanceMinutes !== undefined && {
            allowance_minutes: allowanceMinutes,
          }),
          ...(carryoverMinutes !== undefined && {
            carryover_minutes: carryoverMinutes,
          }),
        },
      });

      if (year === currentYear && allowanceMinutes !== undefined) {
        const updatedEmployee = await tx.employee.updateMany({
          where: { id: employeeId, tenant_id: tenantId },
          data: { annual_leave_minutes: allowanceMinutes },
        });
        if (updatedEmployee.count === 0) {
          throw new NotFoundException(`Employee ${employeeId} not found`);
        }
      }

      return balance;
    });
  }

  private async executeLeaveUpdate(
    tenantId: string,
    leaveId: string,
    range: ValidatedDateRange,
    minutesCharged: number,
    note?: string,
  ) {
    return this.prisma.leaveRequest.update({
      where: {
        tenant_id_id: {
          tenant_id: tenantId,
          id: leaveId,
        },
      },
      data: {
        start_on: range.startOnDate,
        end_on: range.endOnDate,
        minutes_charged: minutesCharged,
        ...(note !== undefined && { note: note?.trim() || null }),
      },
      include: {
        employee: {
          select: { id: true, name: true, role: true },
        },
      },
    });
  }

  /**
   * Loads the tenant calendar and counts chargeable working minutes for the
   * given employee across the validated range. Throws 400 when the range
   * contains zero chargeable minutes.
   */
  private async computeChargeableMinutes(
    tenantId: string,
    employeeId: string,
    range: ValidatedDateRange,
  ): Promise<number> {
    const calendar = await this.workdayService.loadTenantCalendar(tenantId);
    const minutesCharged = await this.workdayService.countChargeableMinutes(
      tenantId,
      employeeId,
      range.startOnStr,
      range.endOnStr,
      calendar.timezone,
      calendar.openingHours,
      calendar.holidays,
    );

    if (minutesCharged === 0) {
      throw new BadRequestException(
        'Leave range contains zero chargeable minutes',
      );
    }

    return minutesCharged;
  }

  /**
   * Checks that no other BOOKED leave for the employee overlaps with the
   * given range. When excludeId is provided that booking is excluded from
   * the check (used during updates).
   */
  private async assertNoOverlap(
    tenantId: string,
    employeeId: string,
    range: ValidatedDateRange,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        tenant_id: tenantId,
        employee_id: employeeId,
        status: LeaveRequestStatus.BOOKED,
        ...(excludeId && { id: { not: excludeId } }),
        start_on: { lte: range.endOnDate },
        end_on: { gte: range.startOnDate },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        'Leave booking overlaps with an existing booking',
      );
    }
  }

  /**
   * Checks that minutesCharged does not exceed the employee's remaining
   * leave for the year. When excludeId is provided that booking's minutes
   * are excluded from the already-booked total (used during updates).
   */
  private async assertSufficientBalance(
    tenantId: string,
    employeeId: string,
    year: number,
    balance: { allowance_minutes: number; carryover_minutes: number },
    minutesCharged: number,
    excludeId?: string,
  ): Promise<void> {
    const aggregate = await this.prisma.leaveRequest.aggregate({
      where: {
        tenant_id: tenantId,
        employee_id: employeeId,
        status: LeaveRequestStatus.BOOKED,
        ...(excludeId && { id: { not: excludeId } }),
        start_on: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      _sum: { minutes_charged: true },
    });

    const alreadyBooked = aggregate._sum.minutes_charged ?? 0;
    const remaining =
      balance.allowance_minutes + balance.carryover_minutes - alreadyBooked;

    if (minutesCharged > remaining) {
      throw new ConflictException('Not enough remaining leave time');
    }
  }

  private async createLeaveBooking(
    input: CreateLeaveBookingInput,
  ): Promise<LeaveRequestResponseDto> {
    const {
      tenantId,
      employeeId,
      annualLeaveMinutes,
      startOnStr,
      endOnStr,
      note,
      createdByUserId,
    } = input;

    const range = validateDateRange(startOnStr, endOnStr);

    const minutesCharged = await this.computeChargeableMinutes(
      tenantId,
      employeeId,
      range,
    );

    await this.assertNoOverlap(tenantId, employeeId, range);

    const balance = await this.getOrUpsertBalance(
      tenantId,
      employeeId,
      range.year,
      annualLeaveMinutes,
    );

    await this.assertSufficientBalance(
      tenantId,
      employeeId,
      range.year,
      balance,
      minutesCharged,
    );

    const created = await this.prisma.leaveRequest.create({
      data: {
        tenant_id: tenantId,
        employee_id: employeeId,
        start_on: range.startOnDate,
        end_on: range.endOnDate,
        status: LeaveRequestStatus.BOOKED,
        minutes_charged: minutesCharged,
        note: note?.trim() || null,
        created_by_user_id: createdByUserId,
      },
      include: {
        employee: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    return toLeaveRequestDto(created);
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
        allowance_minutes: defaultAllowance,
        carryover_minutes: 0,
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

  private toDto = toLeaveRequestDto;
}
