import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LoanerBookingStatus,
  LoanerVehicle,
  LoanerVehicleStatus,
  Prisma,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import type { CreateLoanerBookingDto } from './dto/loaner-booking.dto.js';
import type {
  HandOverLoanerBookingDto,
  ReturnLoanerBookingDto,
  UpdateLoanerBookingDto,
} from './dto/loaner-booking.dto.js';
import type {
  CreateLoanerVehicleDto,
  ListLoanerVehiclesQueryDto,
  LoanerAvailabilityQueryDto,
  UpdateLoanerVehicleDto,
} from './dto/loaner-vehicle.dto.js';
import { ACTIVE_LOANER_BOOKING_STATUSES } from './loaner.constants.js';
import { getLoanerNow } from './loaner-clock.js';
import {
  loanerAlreadyReturnedException,
  loanerFleetDeleteBlockedException,
  loanerFleetNotBookableException,
  loanerInvalidHandoverStateException,
  loanerOdometerInInvalidException,
  loanerOverlapException,
  loanerReturnBeforeHandoverException,
  loanerVehicleOnLoanException,
} from './loaner.errors.js';
import { mapLoanerBooking, mapLoanerVehicle } from './loaner.mapper.js';
import { LoanerVehiclesAuthorization } from './loaner-vehicles.authorization.js';

const LOANER_VEHICLE_INCLUDE = {
  vehicle: {
    select: {
      id: true,
      make: true,
      model: true,
      year: true,
      plate: true,
      vin: true,
    },
  },
} as const;

const LOANER_BOOKING_INCLUDE = {
  customer: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      company_name: true,
    },
  },
  loaner_vehicle: {
    select: { id: true, display_name: true, site_id: true },
  },
} as const;

@Injectable()
export class LoanerVehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly authorization: LoanerVehiclesAuthorization,
  ) {}

  async listFleet(query: ListLoanerVehiclesQueryDto) {
    this.authorization.assertReadAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const rows = await this.prisma.loanerVehicle.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        ...(query.includeInactive ? {} : { active: true }),
      },
      include: LOANER_VEHICLE_INCLUDE,
      orderBy: [{ display_name: 'asc' }],
    });

    return { data: rows.map((row) => mapLoanerVehicle(row)) };
  }

  async getFleetVehicle(id: string) {
    this.authorization.assertReadAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const row = await this.findFleetVehicleOrThrow(tenantId, siteId, id);
    return mapLoanerVehicle(row);
  }

  async createFleetVehicle(dto: CreateLoanerVehicleDto) {
    await this.authorization.assertWriteAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    await this.assertVehicleInTenant(tenantId, dto.vehicleId);

    try {
      const created = await this.prisma.loanerVehicle.create({
        data: {
          site_id: siteId,
          vehicle_id: dto.vehicleId,
          display_name: dto.displayName.trim(),
          status: dto.status ?? LoanerVehicleStatus.AVAILABLE,
          daily_rate_cents: dto.dailyRateCents,
          insurance_note: dto.insuranceNote,
          active: dto.active ?? true,
        } as Prisma.LoanerVehicleUncheckedCreateInput,
        include: LOANER_VEHICLE_INCLUDE,
      });
      return mapLoanerVehicle(created);
    } catch (error) {
      this.rethrowLoanerConstraintIfNeeded(error);
      throw error;
    }
  }

  async updateFleetVehicle(id: string, dto: UpdateLoanerVehicleDto) {
    await this.authorization.assertWriteAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    await this.findFleetVehicleOrThrow(tenantId, siteId, id);

    const updated = await this.prisma.loanerVehicle.update({
      where: { tenant_id_id: { tenant_id: tenantId, id } },
      data: {
        ...(dto.displayName !== undefined && {
          display_name: dto.displayName.trim(),
        }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.dailyRateCents !== undefined && {
          daily_rate_cents: dto.dailyRateCents,
        }),
        ...(dto.insuranceNote !== undefined && {
          insurance_note: dto.insuranceNote,
        }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
      include: LOANER_VEHICLE_INCLUDE,
    });
    return mapLoanerVehicle(updated);
  }

  async deleteFleetVehicle(id: string) {
    await this.authorization.assertWriteAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    await this.findFleetVehicleOrThrow(tenantId, siteId, id);

    const bookingHistory = await this.prisma.loanerBooking.count({
      where: {
        tenant_id: tenantId,
        loaner_vehicle_id: id,
      },
    });
    if (bookingHistory > 0) {
      throw loanerFleetDeleteBlockedException();
    }

    await this.prisma.loanerVehicle.delete({
      where: { tenant_id_id: { tenant_id: tenantId, id } },
    });
    return { id, deleted: true };
  }

  async getAvailability(query: LoanerAvailabilityQueryDto) {
    this.authorization.assertReadAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const from = this.parseDate(query.from, 'from');
    const to = this.parseDate(query.to, 'to');
    if (from >= to) {
      throw new BadRequestException('`to` must be after `from`.');
    }
    const asOf = query.asOf
      ? this.parseDate(query.asOf, 'asOf')
      : getLoanerNow();

    const vehicles = await this.prisma.loanerVehicle.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        active: true,
        status: { not: LoanerVehicleStatus.RETIRED },
      },
      include: LOANER_VEHICLE_INCLUDE,
      orderBy: [{ display_name: 'asc' }],
    });

    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    const handedOver = await this.prisma.loanerBooking.findMany({
      where: {
        tenant_id: tenantId,
        loaner_vehicle_id: { in: vehicleIds },
        status: LoanerBookingStatus.HANDED_OVER,
      },
      select: { loaner_vehicle_id: true },
    });

    const overlappingReserved = await this.prisma.loanerBooking.findMany({
      where: {
        tenant_id: tenantId,
        loaner_vehicle_id: { in: vehicleIds },
        status: LoanerBookingStatus.RESERVED,
        planned_from: { lt: to },
        planned_to: { gt: from },
      },
      select: { loaner_vehicle_id: true },
    });

    const blockedIds = new Set([
      ...handedOver.map((booking) => booking.loaner_vehicle_id),
      ...overlappingReserved.map((booking) => booking.loaner_vehicle_id),
    ]);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      asOf: asOf.toISOString(),
      data: vehicles.map((vehicle) => ({
        vehicle: mapLoanerVehicle(vehicle),
        available:
          !blockedIds.has(vehicle.id) &&
          vehicle.status !== LoanerVehicleStatus.MAINTENANCE,
      })),
    };
  }

  async listBookings() {
    this.authorization.assertReadAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const rows = await this.prisma.loanerBooking.findMany({
      where: {
        tenant_id: tenantId,
        loaner_vehicle: { site_id: siteId },
      },
      include: LOANER_BOOKING_INCLUDE,
      orderBy: [{ planned_from: 'desc' }],
    });

    return { data: rows.map((row) => mapLoanerBooking(row)) };
  }

  async getBooking(id: string) {
    this.authorization.assertReadAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const row = await this.findBookingOrThrow(tenantId, siteId, id);
    return mapLoanerBooking(row);
  }

  async createBooking(dto: CreateLoanerBookingDto) {
    await this.authorization.assertWriteAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const plannedFrom = this.parseDate(dto.plannedFrom, 'plannedFrom');
    const plannedTo = this.parseDate(dto.plannedTo, 'plannedTo');
    this.assertPlannedRange(plannedFrom, plannedTo);

    const fleetVehicle = await this.findFleetVehicleOrThrow(
      tenantId,
      siteId,
      dto.loanerVehicleId,
    );
    this.assertFleetBookable(fleetVehicle);
    await this.assertCustomerInTenant(tenantId, dto.customerId);
    if (dto.workshopOrderId) {
      await this.assertWorkshopOrderInSite(
        tenantId,
        siteId,
        dto.workshopOrderId,
      );
    }

    const authUser = this.tenantContext.getAuthenticatedUser();
    const createdByUserId = authUser?.userId
      ? await this.resolveInternalUserId(authUser.userId, tenantId)
      : null;

    try {
      const created = await this.prisma.loanerBooking.create({
        data: {
          loaner_vehicle_id: dto.loanerVehicleId,
          customer_id: dto.customerId,
          workshop_order_id: dto.workshopOrderId,
          planned_from: plannedFrom,
          planned_to: plannedTo,
          notes: dto.notes,
          created_by_user_id: createdByUserId,
        } as Prisma.LoanerBookingUncheckedCreateInput,
        include: LOANER_BOOKING_INCLUDE,
      });
      return mapLoanerBooking(created);
    } catch (error) {
      this.rethrowLoanerConstraintIfNeeded(error);
      throw error;
    }
  }

  async updateBooking(id: string, dto: UpdateLoanerBookingDto) {
    await this.authorization.assertWriteAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const existing = await this.findBookingOrThrow(tenantId, siteId, id);
    if (existing.status !== LoanerBookingStatus.RESERVED) {
      throw loanerInvalidHandoverStateException(
        'Only reserved bookings can be updated.',
      );
    }

    const plannedFrom = dto.plannedFrom
      ? this.parseDate(dto.plannedFrom, 'plannedFrom')
      : existing.planned_from;
    const plannedTo = dto.plannedTo
      ? this.parseDate(dto.plannedTo, 'plannedTo')
      : existing.planned_to;
    this.assertPlannedRange(plannedFrom, plannedTo);

    if (dto.customerId) {
      await this.assertCustomerInTenant(tenantId, dto.customerId);
    }
    if (dto.workshopOrderId) {
      await this.assertWorkshopOrderInSite(
        tenantId,
        siteId,
        dto.workshopOrderId,
      );
    }

    try {
      const updated = await this.prisma.loanerBooking.update({
        where: { tenant_id_id: { tenant_id: tenantId, id } },
        data: {
          ...(dto.plannedFrom !== undefined && { planned_from: plannedFrom }),
          ...(dto.plannedTo !== undefined && { planned_to: plannedTo }),
          ...(dto.customerId !== undefined && { customer_id: dto.customerId }),
          ...(dto.workshopOrderId !== undefined && {
            workshop_order_id: dto.workshopOrderId,
          }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: LOANER_BOOKING_INCLUDE,
      });
      return mapLoanerBooking(updated);
    } catch (error) {
      this.rethrowLoanerConstraintIfNeeded(error);
      throw error;
    }
  }

  async cancelBooking(id: string) {
    await this.authorization.assertWriteAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.loanerBooking.updateMany({
        where: {
          tenant_id: tenantId,
          id,
          status: LoanerBookingStatus.RESERVED,
          loaner_vehicle: { site_id: siteId },
        },
        data: { status: LoanerBookingStatus.CANCELLED },
      });
      if (result.count === 0) {
        await this.assertCancelAllowed(tenantId, siteId, id);
      }

      const booking = await tx.loanerBooking.findFirstOrThrow({
        where: { tenant_id: tenantId, id },
        include: LOANER_BOOKING_INCLUDE,
      });
      await this.syncLoanerVehicleStatus(
        tx,
        tenantId,
        siteId,
        booking.loaner_vehicle_id,
      );
      return booking;
    });

    return mapLoanerBooking(updated);
  }

  async markNoShow(id: string) {
    await this.authorization.assertWriteAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.loanerBooking.updateMany({
        where: {
          tenant_id: tenantId,
          id,
          status: LoanerBookingStatus.RESERVED,
          loaner_vehicle: { site_id: siteId },
        },
        data: { status: LoanerBookingStatus.NO_SHOW },
      });
      if (result.count === 0) {
        const existing = await this.findBookingOrThrow(tenantId, siteId, id);
        if (
          existing.status === LoanerBookingStatus.RETURNED ||
          existing.status === LoanerBookingStatus.CANCELLED ||
          existing.status === LoanerBookingStatus.NO_SHOW
        ) {
          throw loanerAlreadyReturnedException();
        }
        throw loanerInvalidHandoverStateException(
          'Only reserved bookings can be marked as no-show.',
        );
      }

      const booking = await tx.loanerBooking.findFirstOrThrow({
        where: { tenant_id: tenantId, id },
        include: LOANER_BOOKING_INCLUDE,
      });
      await this.syncLoanerVehicleStatus(
        tx,
        tenantId,
        siteId,
        booking.loaner_vehicle_id,
      );
      return booking;
    });

    return mapLoanerBooking(updated);
  }

  async handOverBooking(id: string, dto: HandOverLoanerBookingDto) {
    await this.authorization.assertWriteAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const existing = await this.findBookingOrThrow(tenantId, siteId, id);
    if (!dto.driverLicenceChecked) {
      throw loanerInvalidHandoverStateException(
        'Driver licence must be checked before handover.',
      );
    }
    if (dto.licenceCheckedById) {
      await this.assertEmployeeInTenant(tenantId, dto.licenceCheckedById);
    }

    const fleetVehicle = await this.findFleetVehicleOrThrow(
      tenantId,
      siteId,
      existing.loaner_vehicle_id,
    );
    this.assertFleetBookable(fleetVehicle);

    const now = getLoanerNow();
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.loanerBooking.updateMany({
          where: {
            tenant_id: tenantId,
            id,
            status: LoanerBookingStatus.RESERVED,
            loaner_vehicle: { site_id: siteId },
          },
          data: {
            status: LoanerBookingStatus.HANDED_OVER,
            handed_over_at: now,
            odometer_out: dto.odometerOut,
            fuel_out: dto.fuelOut,
            driver_licence_checked: true,
            licence_checked_by_id: dto.licenceCheckedById ?? null,
            damage_notes_out: dto.damageNotesOut ?? null,
          },
        });
        if (result.count === 0) {
          const current = await tx.loanerBooking.findFirst({
            where: { tenant_id: tenantId, id },
            select: { status: true },
          });
          if (!current) {
            throw new NotFoundException(`Loaner booking ${id} not found`);
          }
          if (current.status !== LoanerBookingStatus.RESERVED) {
            throw loanerInvalidHandoverStateException();
          }
          throw loanerInvalidHandoverStateException();
        }

        const booking = await tx.loanerBooking.findFirstOrThrow({
          where: { tenant_id: tenantId, id },
          include: LOANER_BOOKING_INCLUDE,
        });
        await this.syncLoanerVehicleStatus(
          tx,
          tenantId,
          siteId,
          booking.loaner_vehicle_id,
        );
        return booking;
      });

      return mapLoanerBooking(updated);
    } catch (error) {
      this.rethrowLoanerConstraintIfNeeded(error);
      throw error;
    }
  }

  async returnBooking(id: string, dto: ReturnLoanerBookingDto) {
    await this.authorization.assertWriteAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const existing = await this.findBookingOrThrow(tenantId, siteId, id);
    if (
      existing.odometer_out != null &&
      dto.odometerIn < existing.odometer_out
    ) {
      throw loanerOdometerInInvalidException();
    }

    const now = getLoanerNow();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.loanerBooking.updateMany({
        where: {
          tenant_id: tenantId,
          id,
          status: LoanerBookingStatus.HANDED_OVER,
          loaner_vehicle: { site_id: siteId },
        },
        data: {
          status: LoanerBookingStatus.RETURNED,
          returned_at: now,
          odometer_in: dto.odometerIn,
          fuel_in: dto.fuelIn,
          damage_notes_in: dto.damageNotesIn ?? null,
        },
      });
      if (result.count === 0) {
        if (
          existing.status === LoanerBookingStatus.RETURNED ||
          existing.status === LoanerBookingStatus.CANCELLED
        ) {
          throw loanerAlreadyReturnedException();
        }
        throw loanerReturnBeforeHandoverException();
      }

      const booking = await tx.loanerBooking.findFirstOrThrow({
        where: { tenant_id: tenantId, id },
        include: LOANER_BOOKING_INCLUDE,
      });
      await this.syncLoanerVehicleStatus(
        tx,
        tenantId,
        siteId,
        booking.loaner_vehicle_id,
      );
      return booking;
    });

    return mapLoanerBooking(updated);
  }

  async listOverdue(asOfRaw?: string) {
    this.authorization.assertReadAccess();
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const asOf = asOfRaw ? this.parseDate(asOfRaw, 'asOf') : getLoanerNow();

    const rows = await this.prisma.loanerBooking.findMany({
      where: {
        tenant_id: tenantId,
        loaner_vehicle: { site_id: siteId },
        status: { in: [...ACTIVE_LOANER_BOOKING_STATUSES] },
        planned_to: { lt: asOf },
      },
      include: LOANER_BOOKING_INCLUDE,
      orderBy: [{ planned_to: 'asc' }],
    });

    return {
      data: rows.map((row) => mapLoanerBooking(row)),
      asOf: asOf.toISOString(),
    };
  }

  /** @internal exposed for unit tests */
  parseDate(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid date for ${field}.`);
    }
    return parsed;
  }

  /** @internal exposed for unit tests */
  assertPlannedRange(from: Date, to: Date): void {
    if (from >= to) {
      throw new BadRequestException('plannedTo must be after plannedFrom.');
    }
  }

  /** @internal exposed for unit tests */
  rethrowOverlapIfNeeded(error: unknown): void {
    this.rethrowLoanerConstraintIfNeeded(error);
  }

  /** @internal exposed for unit tests */
  rethrowLoanerConstraintIfNeeded(error: unknown): void {
    if (this.isLoanerOverlapError(error)) {
      throw loanerOverlapException();
    }
    if (this.isLoanerVehicleOnLoanError(error)) {
      throw loanerVehicleOnLoanException();
    }
  }

  /** @internal exposed for unit tests */
  isLoanerOverlapError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const databaseCode =
        error.meta &&
        typeof error.meta === 'object' &&
        'database_error_code' in error.meta
          ? String(
              (error.meta as { database_error_code?: unknown })
                .database_error_code,
            )
          : undefined;
      if (databaseCode === '23P01') {
        return true;
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);

    return (
      message.includes('23P01') ||
      message.includes('loaner_bookings_no_active_overlap')
    );
  }

  /** @internal exposed for unit tests */
  isLoanerVehicleOnLoanError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = error.meta?.target;
        const targetText = Array.isArray(target)
          ? target.join(',')
          : typeof target === 'string'
            ? target
            : '';
        if (
          targetText.includes('loaner_bookings_one_handed_over_per_vehicle')
        ) {
          return true;
        }
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);

    return message.includes('loaner_bookings_one_handed_over_per_vehicle');
  }

  private assertFleetBookable(
    vehicle: Pick<LoanerVehicle, 'active' | 'status'>,
  ): void {
    if (!vehicle.active) {
      throw loanerFleetNotBookableException(
        'This loaner vehicle is inactive and cannot be booked.',
      );
    }
    if (
      vehicle.status === LoanerVehicleStatus.MAINTENANCE ||
      vehicle.status === LoanerVehicleStatus.RETIRED
    ) {
      throw loanerFleetNotBookableException();
    }
  }

  private async assertCancelAllowed(
    tenantId: string,
    siteId: string,
    id: string,
  ): Promise<void> {
    const existing = await this.findBookingOrThrow(tenantId, siteId, id);
    if (
      existing.status === LoanerBookingStatus.RETURNED ||
      existing.status === LoanerBookingStatus.CANCELLED ||
      existing.status === LoanerBookingStatus.NO_SHOW
    ) {
      throw loanerAlreadyReturnedException();
    }
    if (existing.status === LoanerBookingStatus.HANDED_OVER) {
      throw loanerInvalidHandoverStateException(
        'Handed-over bookings must be returned, not cancelled.',
      );
    }
    throw loanerInvalidHandoverStateException(
      'Only reserved bookings can be cancelled.',
    );
  }

  private async findFleetVehicleOrThrow(
    tenantId: string,
    siteId: string,
    id: string,
  ) {
    const row = await this.prisma.loanerVehicle.findFirst({
      where: { tenant_id: tenantId, site_id: siteId, id },
      include: LOANER_VEHICLE_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException(`Loaner vehicle ${id} not found`);
    }
    return row;
  }

  private async findBookingOrThrow(
    tenantId: string,
    siteId: string,
    id: string,
  ) {
    const row = await this.prisma.loanerBooking.findFirst({
      where: {
        tenant_id: tenantId,
        id,
        loaner_vehicle: { site_id: siteId },
      },
      include: LOANER_BOOKING_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException(`Loaner booking ${id} not found`);
    }
    return row;
  }

  private async assertVehicleInTenant(tenantId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { tenant_id: tenantId, id: vehicleId },
      select: { id: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
  }

  private async assertCustomerInTenant(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { tenant_id: tenantId, id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
  }

  private async assertWorkshopOrderInSite(
    tenantId: string,
    siteId: string,
    workshopOrderId: string,
  ) {
    const order = await this.prisma.workshopOrder.findFirst({
      where: {
        tenant_id: tenantId,
        id: workshopOrderId,
        site_id: siteId,
      },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException(
        `Workshop order ${workshopOrderId} not found`,
      );
    }
  }

  private async assertEmployeeInTenant(tenantId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { tenant_id: tenantId, id: employeeId, is_active: true },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }
  }

  private async resolveInternalUserId(
    firebaseUid: string,
    tenantId: string,
  ): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { firebaseUid, active_tenant_id: tenantId },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async syncLoanerVehicleStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    loanerVehicleId: string,
  ) {
    const vehicle = await tx.loanerVehicle.findFirst({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        id: loanerVehicleId,
      },
      select: { status: true },
    });
    if (!vehicle) {
      return;
    }
    if (
      vehicle.status === LoanerVehicleStatus.MAINTENANCE ||
      vehicle.status === LoanerVehicleStatus.RETIRED
    ) {
      return;
    }

    const handedOver = await tx.loanerBooking.findFirst({
      where: {
        tenant_id: tenantId,
        loaner_vehicle_id: loanerVehicleId,
        status: LoanerBookingStatus.HANDED_OVER,
      },
      select: { id: true },
    });

    const nextStatus = handedOver
      ? LoanerVehicleStatus.ON_LOAN
      : LoanerVehicleStatus.AVAILABLE;

    if (vehicle.status !== nextStatus) {
      await tx.loanerVehicle.update({
        where: { tenant_id_id: { tenant_id: tenantId, id: loanerVehicleId } },
        data: { status: nextStatus },
      });
    }
  }
}
