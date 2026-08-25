import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceEvent,
  AttendanceEventSource,
  AttendanceEventType,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatLocalDate,
  parseLocalDate,
  zonedWallClockToUtc,
} from '../workshop/workshop-planner.time';
import {
  CreateHrAttendanceDto,
  QueryHrAttendanceDto,
} from './dto/hr-attendance.dto';
import {
  AttendanceEventResponseDto,
  AttendanceState,
  ClockResponseDto,
  HrMeResponseDto,
  PunchResponseDto,
} from './dto/hr-clock.dto';
import { HrIdentityService } from './hr-identity.service';

export const ALLOWED_NEXT: Record<AttendanceState, AttendanceEventType[]> = {
  CLOCKED_OUT: [AttendanceEventType.CLOCK_IN],
  CLOCKED_IN: [
    AttendanceEventType.PAUSE,
    AttendanceEventType.DOCTOR,
    AttendanceEventType.CLOCK_OUT,
  ],
  PAUSED: [AttendanceEventType.CLOCK_IN, AttendanceEventType.CLOCK_OUT],
  AT_DOCTOR: [AttendanceEventType.CLOCK_IN, AttendanceEventType.CLOCK_OUT],
};

export function deriveAttendanceState(
  lastEventType?: AttendanceEventType | null,
): AttendanceState {
  if (!lastEventType || lastEventType === AttendanceEventType.CLOCK_OUT) {
    return 'CLOCKED_OUT';
  }
  if (lastEventType === AttendanceEventType.CLOCK_IN) {
    return 'CLOCKED_IN';
  }
  if (lastEventType === AttendanceEventType.PAUSE) {
    return 'PAUSED';
  }
  if (lastEventType === AttendanceEventType.DOCTOR) {
    return 'AT_DOCTOR';
  }
  return 'CLOCKED_OUT';
}

export function mapAttendanceEvent(
  event: AttendanceEvent,
): AttendanceEventResponseDto {
  return {
    id: event.id,
    employeeId: event.employee_id,
    type: event.type,
    source: event.source,
    occurredAt: event.occurred_at,
    note: event.note,
    createdAt: event.createdAt,
  };
}

@Injectable()
export class HrAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: HrIdentityService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private async getTenantTimezone(tenantId: string): Promise<string> {
    const settings = await this.prisma.workshopSettings.findFirst({
      where: { tenant_id: tenantId },
      select: { timezone: true },
    });
    return settings?.timezone || 'Europe/Vienna';
  }

  private async getClockForEmployee(
    employeeId: string,
    tenantId: string,
    timezone: string,
  ): Promise<ClockResponseDto> {
    const todayStr = formatLocalDate(new Date(), timezone);
    const { year, month, day } = parseLocalDate(todayStr);
    const startOfToday = zonedWallClockToUtc(timezone, year, month, day, 0, 0);
    const startOfTomorrow = zonedWallClockToUtc(
      timezone,
      year,
      month,
      day + 1,
      0,
      0,
    );
    const endOfToday = new Date(startOfTomorrow.getTime() - 1);

    const [todayEvents, lastEvent] = await Promise.all([
      this.prisma.attendanceEvent.findMany({
        where: {
          tenant_id: tenantId,
          employee_id: employeeId,
          occurred_at: {
            gte: startOfToday,
            lte: endOfToday,
          },
        },
        orderBy: [{ occurred_at: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.attendanceEvent.findFirst({
        where: {
          tenant_id: tenantId,
          employee_id: employeeId,
        },
        orderBy: [{ occurred_at: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    const state = deriveAttendanceState(lastEvent?.type);

    return {
      timezone,
      state,
      lastEvent: lastEvent ? mapAttendanceEvent(lastEvent) : null,
      todayEvents: todayEvents.map(mapAttendanceEvent),
    };
  }

  async punchMe(
    type: AttendanceEventType,
    note?: string,
  ): Promise<PunchResponseDto> {
    const me = await this.identity.resolveMe();
    const tenantId = await this.tenantContext.getTenantId();

    const event = await this.prisma.$transaction(
      async (tx) => {
        const lastEvent = await tx.attendanceEvent.findFirst({
          where: {
            tenant_id: tenantId,
            employee_id: me.id,
          },
          orderBy: [{ occurred_at: 'desc' }, { createdAt: 'desc' }],
        });

        const currentState = deriveAttendanceState(lastEvent?.type);
        const allowed = ALLOWED_NEXT[currentState];

        if (!allowed.includes(type)) {
          throw new ConflictException(
            `Cannot punch ${type} while in state ${currentState}`,
          );
        }

        return tx.attendanceEvent.create({
          data: {
            tenant_id: tenantId,
            employee_id: me.id,
            type,
            source: AttendanceEventSource.SELF,
            occurred_at: new Date(),
            note: note ?? null,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    const newState = deriveAttendanceState(type);

    return {
      state: newState,
      event: mapAttendanceEvent(event),
    };
  }

  async getMeProfile(): Promise<HrMeResponseDto> {
    const me = await this.identity.resolveMe();
    const tenantId = await this.tenantContext.getTenantId();
    const timezone = await this.getTenantTimezone(tenantId);
    const currentYear = Number(
      formatLocalDate(new Date(), timezone).slice(0, 4),
    );

    const [lastEvent, balance, leaveSum] = await Promise.all([
      this.prisma.attendanceEvent.findFirst({
        where: {
          tenant_id: tenantId,
          employee_id: me.id,
        },
        orderBy: [{ occurred_at: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.employeeLeaveBalance.findFirst({
        where: {
          tenant_id: tenantId,
          employee_id: me.id,
          year: currentYear,
        },
      }),
      this.prisma.leaveRequest.aggregate({
        where: {
          tenant_id: tenantId,
          employee_id: me.id,
          status: 'BOOKED',
          start_on: {
            gte: new Date(Date.UTC(currentYear, 0, 1)),
            lte: new Date(Date.UTC(currentYear, 11, 31)),
          },
        },
        _sum: { minutes_charged: true },
      }),
    ]);

    const clockState = deriveAttendanceState(lastEvent?.type);
    const allowance = balance?.allowance_minutes ?? me.annual_leave_minutes;
    const carryover = balance?.carryover_minutes ?? 0;
    const bookedMinutes = leaveSum._sum.minutes_charged ?? 0;
    const remainingLeaveMinutes = allowance + carryover - bookedMinutes;

    return {
      employee: {
        id: me.id,
        name: me.name,
        role: me.role,
        hiredOn: me.hired_on ? formatLocalDate(me.hired_on, 'UTC') : null,
        annualLeaveMinutes: me.annual_leave_minutes,
      },
      clockState,
      remainingLeaveMinutes,
      timezone,
    };
  }

  async getMyClock(): Promise<ClockResponseDto> {
    const me = await this.identity.resolveMe();
    const tenantId = await this.tenantContext.getTenantId();
    const timezone = await this.getTenantTimezone(tenantId);

    return this.getClockForEmployee(me.id, tenantId, timezone);
  }

  async getEmployeeClock(employeeId: string): Promise<ClockResponseDto> {
    this.identity.assertOwnerAdmin();
    const tenantId = await this.tenantContext.getTenantId();
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        tenant_id: tenantId,
        is_active: true,
      },
      select: { id: true },
    });

    if (!employee) {
      throw new NotFoundException(
        `Active employee ${employeeId} not found in this tenant`,
      );
    }

    const timezone = await this.getTenantTimezone(tenantId);
    return this.getClockForEmployee(employee.id, tenantId, timezone);
  }

  async getAttendance(
    query: QueryHrAttendanceDto,
  ): Promise<AttendanceEventResponseDto[]> {
    this.identity.assertOwnerAdmin();
    const tenantId = await this.tenantContext.getTenantId();
    const timezone = await this.getTenantTimezone(tenantId);

    const {
      year: fromY,
      month: fromM,
      day: fromD,
    } = parseLocalDate(query.from);
    const { year: toY, month: toM, day: toD } = parseLocalDate(query.to);

    const startUtcGuess = Date.UTC(fromY, fromM - 1, fromD);
    const endUtcGuess = Date.UTC(toY, toM - 1, toD);

    if (endUtcGuess < startUtcGuess) {
      throw new BadRequestException(
        'to date must be greater than or equal to from date',
      );
    }

    const diffDays =
      Math.round((endUtcGuess - startUtcGuess) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > 31) {
      throw new BadRequestException('Date range cannot exceed 31 days');
    }

    const rangeStart = zonedWallClockToUtc(timezone, fromY, fromM, fromD, 0, 0);
    const nextToStart = zonedWallClockToUtc(timezone, toY, toM, toD + 1, 0, 0);
    const rangeEnd = new Date(nextToStart.getTime() - 1);

    const events = await this.prisma.attendanceEvent.findMany({
      where: {
        tenant_id: tenantId,
        ...(query.employeeId ? { employee_id: query.employeeId } : {}),
        occurred_at: {
          gte: rangeStart,
          lte: rangeEnd,
        },
      },
      orderBy: [{ occurred_at: 'asc' }, { createdAt: 'asc' }],
    });

    return events.map(mapAttendanceEvent);
  }

  async punchEmployee(dto: CreateHrAttendanceDto): Promise<PunchResponseDto> {
    this.identity.assertOwnerAdmin();
    const tenantId = await this.tenantContext.getTenantId();

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: dto.employeeId,
        tenant_id: tenantId,
        is_active: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(
        `Active employee ${dto.employeeId} not found in this tenant`,
      );
    }

    const event = await this.prisma.$transaction(
      async (tx) => {
        const lastEvent = await tx.attendanceEvent.findFirst({
          where: {
            tenant_id: tenantId,
            employee_id: dto.employeeId,
          },
          orderBy: [{ occurred_at: 'desc' }, { createdAt: 'desc' }],
        });

        const currentState = deriveAttendanceState(lastEvent?.type);
        const allowed = ALLOWED_NEXT[currentState];

        if (!allowed.includes(dto.type)) {
          throw new ConflictException(
            `Cannot punch ${dto.type} while employee is in state ${currentState}`,
          );
        }

        let occurredAt = new Date();
        if (dto.occurredAt) {
          const parsed = new Date(dto.occurredAt);
          if (isNaN(parsed.getTime())) {
            throw new BadRequestException('Invalid occurredAt timestamp');
          }
          if (lastEvent && parsed <= lastEvent.occurred_at) {
            throw new ConflictException(
              'occurredAt must be strictly after the previous attendance event',
            );
          }
          occurredAt = parsed;
        }

        return tx.attendanceEvent.create({
          data: {
            tenant_id: tenantId,
            employee_id: dto.employeeId,
            type: dto.type,
            source: AttendanceEventSource.MANAGER,
            occurred_at: occurredAt,
            note: dto.note ?? null,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    const newState = deriveAttendanceState(dto.type);

    return {
      state: newState,
      event: mapAttendanceEvent(event),
    };
  }
}
