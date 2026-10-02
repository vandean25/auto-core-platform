import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type TyreSet, type TyreSetEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  assertTyreStorageRead,
  assertTyreStorageWrite,
} from './tyre-storage-access.js';
import {
  derivePlannedSwapOn,
  isDueForSwap,
} from './tyre-storage-season.helpers.js';
import { applyTyreSetEvent } from './tyre-set-event.helpers.js';
import { TyreStorageClock } from './tyre-storage.clock.js';
import type { TyreSetListQueryDto } from './dto/tyre-set-list-query.dto.js';
import type {
  CreateTyreSetDto,
  TyreSetLocationActionDto,
  TyreSetResponseDto,
  UpdateTyreSetDto,
  UpdateTyreStorageSettingsDto,
  TyreStorageSettingsResponseDto,
} from './dto/tyre-set.dto.js';

type TyreSetWithRelations = TyreSet & {
  customer: {
    first_name: string;
    last_name: string;
    phone: string | null;
    email: string | null;
  };
  vehicle: { plate: string | null } | null;
  location?: { code: string } | null;
  events?: TyreSetEvent[];
};

@Injectable()
export class TyreStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly clock: TyreStorageClock,
  ) {}

  async getSettings(): Promise<TyreStorageSettingsResponseDto> {
    assertTyreStorageRead(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const settings = await this.ensureSettings(tenantId);
    return this.toSettingsResponse(settings);
  }

  async updateSettings(
    dto: UpdateTyreStorageSettingsDto,
  ): Promise<TyreStorageSettingsResponseDto> {
    assertTyreStorageWrite(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    this.assertValidSwapCalendar(dto);

    const updated = await this.prisma.tyreStorageSettings.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        summer_swap_month: dto.summerSwapMonth,
        summer_swap_day: dto.summerSwapDay,
        winter_swap_month: dto.winterSwapMonth,
        winter_swap_day: dto.winterSwapDay,
        due_for_swap_days: dto.dueForSwapDays,
      },
      update: {
        summer_swap_month: dto.summerSwapMonth,
        summer_swap_day: dto.summerSwapDay,
        winter_swap_month: dto.winterSwapMonth,
        winter_swap_day: dto.winterSwapDay,
        due_for_swap_days: dto.dueForSwapDays,
      },
    });
    return this.toSettingsResponse(updated);
  }

  async list(query: TyreSetListQueryDto) {
    assertTyreStorageRead(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize =
      query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 25;

    const where: Prisma.TyreSetWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
    };
    if (query.customerId) where.customer_id = query.customerId;
    if (query.locationId) where.location_id = query.locationId;
    if (query.season) where.season = query.season;
    if (query.status) where.status = query.status;
    if (query.dueFrom || query.dueTo) {
      where.planned_swap_on = {};
      if (query.dueFrom) {
        where.planned_swap_on.gte = new Date(query.dueFrom);
      }
      if (query.dueTo) {
        where.planned_swap_on.lte = new Date(query.dueTo);
      }
    }
    if (query.vehicleSearch) {
      const term = query.vehicleSearch.trim();
      where.vehicle = {
        OR: [
          { plate: { contains: term, mode: 'insensitive' } },
          { vin: { contains: term, mode: 'insensitive' } },
        ],
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.tyreSet.count({ where }),
      this.prisma.tyreSet.findMany({
        where,
        include: {
          customer: {
            select: {
              first_name: true,
              last_name: true,
              phone: true,
              email: true,
            },
          },
          vehicle: { select: { plate: true } },
          location: { select: { code: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toResponse(row)),
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async listDueForSwap() {
    assertTyreStorageRead(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const settings = await this.ensureSettings(tenantId);
    const asOf = this.clock.now();
    const windowEnd = new Date(asOf);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + settings.due_for_swap_days);

    const rows = await this.prisma.tyreSet.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        status: 'IN_STORAGE',
        planned_swap_on: {
          not: null,
          lte: windowEnd,
        },
      },
      include: {
        customer: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
            email: true,
          },
        },
        vehicle: { select: { plate: true } },
        location: { select: { code: true } },
      },
      orderBy: { planned_swap_on: 'asc' },
    });

    return {
      data: rows
        .filter((row) =>
          isDueForSwap(row.planned_swap_on, settings.due_for_swap_days, asOf),
        )
        .map((row) => this.toResponse(row)),
    };
  }

  async exportDueForSwapCsv(): Promise<string> {
    const { data } = await this.listDueForSwap();
    const header =
      'label,season,planned_swap_on,customer,phone,email,plate,bin_label,location_code';
    const lines = data.map((row) =>
      [
        csvEscape(row.label),
        row.season,
        row.plannedSwapOn ?? '',
        csvEscape(row.customerName ?? ''),
        csvEscape(row.customerPhone ?? ''),
        csvEscape(row.customerEmail ?? ''),
        csvEscape(row.vehiclePlate ?? ''),
        csvEscape(row.binLabel ?? ''),
        csvEscape(row.locationCode ?? ''),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  async findByCustomer(customerId: string) {
    return this.list({ customerId, pageSize: 100 });
  }

  async findByVehicle(vehicleId: string) {
    assertTyreStorageRead(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const rows = await this.prisma.tyreSet.findMany({
      where: { tenant_id: tenantId, site_id: siteId, vehicle_id: vehicleId },
      include: {
        customer: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
            email: true,
          },
        },
        vehicle: { select: { plate: true } },
        location: { select: { code: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { data: rows.map((row) => this.toResponse(row)) };
  }

  async findOne(id: string, includeEvents = true) {
    assertTyreStorageRead(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const row = await this.prisma.tyreSet.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
      include: {
        customer: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
            email: true,
          },
        },
        vehicle: { select: { plate: true } },
        location: { select: { code: true } },
        events: includeEvents ? { orderBy: { occurred_at: 'desc' } } : false,
      },
    });
    if (!row) {
      throw new NotFoundException(`Tyre set ${id} not found`);
    }
    return this.toResponse(row);
  }

  async create(dto: CreateTyreSetDto) {
    assertTyreStorageWrite(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const userId = this.tenantContext.getAuthenticatedUser()?.userId ?? null;
    const settings = await this.ensureSettings(tenantId);

    await this.assertCustomer(tenantId, dto.customerId);
    if (dto.vehicleId) {
      await this.assertVehicle(tenantId, dto.vehicleId, dto.customerId);
    }
    if (dto.locationId) {
      await this.assertLocationOnSite(tenantId, siteId, dto.locationId);
    }

    const now = this.clock.now();
    const planned =
      dto.plannedSwapOn != null
        ? new Date(dto.plannedSwapOn)
        : derivePlannedSwapOn(dto.season, settings, now);

    const created = await this.prisma.$transaction(async (tx) => {
      const set = await tx.tyreSet.create({
        data: {
          tenant_id: tenantId,
          customer_id: dto.customerId,
          vehicle_id: dto.vehicleId ?? null,
          site_id: siteId,
          location_id: dto.locationId ?? null,
          label: dto.label,
          season: dto.season,
          tyre_count: dto.tyreCount ?? 4,
          rim_type: dto.rimType ?? 'NONE',
          brand: dto.brand ?? null,
          model: dto.model ?? null,
          dimension: dto.dimension ?? null,
          dot_codes: dto.dotCodes ?? [],
          tread_depth_mm_json: (dto.treadDepthMm ??
            undefined) as Prisma.InputJsonValue,
          condition_notes: dto.conditionNotes ?? null,
          status: dto.locationId ? 'IN_STORAGE' : 'RETURNED',
          stored_since: dto.locationId ? now : null,
          planned_swap_on: planned,
          bin_label: dto.binLabel ?? null,
          created_by_user_id: userId,
        },
      });

      if (dto.locationId) {
        await tx.tyreSetEvent.create({
          data: {
            tenant_id: tenantId,
            tyre_set_id: set.id,
            event_type: 'CHECK_IN',
            occurred_at: now,
            to_location_id: dto.locationId,
            tread_depth_mm_json: (dto.treadDepthMm ??
              undefined) as Prisma.InputJsonValue,
            created_by_user_id: userId,
          },
        });
      }

      return set;
    });

    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdateTyreSetDto) {
    assertTyreStorageWrite(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const existing = await this.prisma.tyreSet.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    if (!existing) {
      throw new NotFoundException(`Tyre set ${id} not found`);
    }
    if (dto.vehicleId) {
      await this.assertVehicle(tenantId, dto.vehicleId, existing.customer_id);
    }
    const settings = await this.ensureSettings(tenantId);
    const season = dto.season ?? existing.season;
    const planned =
      dto.plannedSwapOn !== undefined
        ? dto.plannedSwapOn
          ? new Date(dto.plannedSwapOn)
          : null
        : dto.season
          ? derivePlannedSwapOn(season, settings, this.clock.now())
          : existing.planned_swap_on;

    await this.prisma.tyreSet.update({
      where: { id },
      data: {
        vehicle_id: dto.vehicleId === undefined ? undefined : dto.vehicleId,
        label: dto.label,
        season: dto.season,
        tyre_count: dto.tyreCount,
        rim_type: dto.rimType,
        brand: dto.brand === undefined ? undefined : dto.brand,
        model: dto.model === undefined ? undefined : dto.model,
        dimension: dto.dimension === undefined ? undefined : dto.dimension,
        dot_codes: dto.dotCodes,
        tread_depth_mm_json:
          dto.treadDepthMm === undefined
            ? undefined
            : dto.treadDepthMm === null
              ? Prisma.JsonNull
              : (dto.treadDepthMm as Prisma.InputJsonValue),
        condition_notes:
          dto.conditionNotes === undefined ? undefined : dto.conditionNotes,
        bin_label: dto.binLabel === undefined ? undefined : dto.binLabel,
        planned_swap_on: planned === undefined ? undefined : planned,
      },
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    assertTyreStorageWrite(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const existing = await this.prisma.tyreSet.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    if (!existing) {
      throw new NotFoundException(`Tyre set ${id} not found`);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const eventCount = await tx.tyreSetEvent.count({
          where: { tenant_id: tenantId, tyre_set_id: id },
        });
        if (eventCount > 0) {
          throw new ConflictException(
            'Tyre sets with event history cannot be deleted; record a dispose event instead.',
          );
        }
        await tx.tyreSet.delete({ where: { id } });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'Tyre sets with event history cannot be deleted; record a dispose event instead.',
        );
      }
      throw error;
    }
    return { ok: true };
  }

  async checkIn(id: string, dto: TyreSetLocationActionDto) {
    return this.recordLocationEvent(id, 'CHECK_IN', dto);
  }

  async checkOut(id: string, dto: TyreSetLocationActionDto) {
    return this.recordLocationEvent(id, 'CHECK_OUT', dto);
  }

  async move(id: string, dto: TyreSetLocationActionDto) {
    return this.recordLocationEvent(id, 'MOVED', dto);
  }

  async dispose(id: string, dto: TyreSetLocationActionDto) {
    return this.recordLocationEvent(id, 'DISPOSED', dto);
  }

  private async recordLocationEvent(
    id: string,
    eventType: 'CHECK_IN' | 'CHECK_OUT' | 'MOVED' | 'DISPOSED',
    dto: TyreSetLocationActionDto,
  ) {
    assertTyreStorageWrite(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const userId = this.tenantContext.getAuthenticatedUser()?.userId ?? null;
    const occurredAt = dto.occurredAt
      ? new Date(dto.occurredAt)
      : this.clock.now();

    const set = await this.prisma.tyreSet.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    if (!set) {
      throw new NotFoundException(`Tyre set ${id} not found`);
    }

    const toLocationId =
      eventType === 'CHECK_OUT' || eventType === 'DISPOSED'
        ? null
        : (dto.locationId ?? set.location_id);
    if (
      eventType !== 'CHECK_OUT' &&
      eventType !== 'DISPOSED' &&
      !toLocationId
    ) {
      throw new UnprocessableEntityException('locationId is required');
    }
    if (
      eventType === 'MOVED' &&
      toLocationId &&
      toLocationId === set.location_id
    ) {
      throw new UnprocessableEntityException(
        'Destination must differ from the current location.',
      );
    }
    if (toLocationId) {
      await this.assertLocationOnSite(tenantId, set.site_id, toLocationId);
    }
    if (dto.workshopOrderId) {
      await this.assertWorkshopOrder(
        tenantId,
        set.site_id,
        dto.workshopOrderId,
      );
    }
    if (dto.employeeId) {
      await this.assertEmployee(tenantId, dto.employeeId);
    }

    const expectedStatus = set.status;
    const patch = applyTyreSetEvent(set, eventType, toLocationId, occurredAt);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tyreSet.updateMany({
        where: {
          id: set.id,
          tenant_id: tenantId,
          site_id: siteId,
          status: expectedStatus,
          location_id: set.location_id,
        },
        data: {
          status: patch.status,
          location_id: patch.location_id,
          stored_since: patch.stored_since,
          tread_depth_mm_json: dto.treadDepthMm
            ? (dto.treadDepthMm as Prisma.InputJsonValue)
            : undefined,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException(
          'Tyre set status changed concurrently. Please refresh.',
        );
      }
      await tx.tyreSetEvent.create({
        data: {
          tenant_id: tenantId,
          tyre_set_id: set.id,
          event_type: eventType,
          occurred_at: occurredAt,
          workshop_order_id: dto.workshopOrderId ?? null,
          from_location_id: set.location_id,
          to_location_id: toLocationId,
          odometer: dto.odometer ?? null,
          tread_depth_mm_json: (dto.treadDepthMm ??
            undefined) as Prisma.InputJsonValue,
          note: dto.note ?? null,
          employee_id: dto.employeeId ?? null,
          created_by_user_id: userId,
        },
      });
    });

    return this.findOne(id);
  }

  private assertValidSwapCalendar(dto: UpdateTyreStorageSettingsDto): void {
    this.assertSwapDay(dto.summerSwapMonth, dto.summerSwapDay, 'summer');
    this.assertSwapDay(dto.winterSwapMonth, dto.winterSwapDay, 'winter');
  }

  private assertSwapDay(month: number, day: number, label: string): void {
    const probe = new Date(Date.UTC(2024, month - 1, day));
    if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
      throw new UnprocessableEntityException(
        `Invalid ${label} swap day for the given month.`,
      );
    }
  }

  private async assertEmployee(tenantId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }
  }

  private async ensureSettings(tenantId: string) {
    return this.prisma.tyreStorageSettings.upsert({
      where: { tenant_id: tenantId },
      create: { tenant_id: tenantId },
      update: {},
    });
  }

  private async assertCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
  }

  private async assertVehicle(
    tenantId: string,
    vehicleId: string,
    customerId: string,
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      select: { id: true, customer_id: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    if (vehicle.customer_id && vehicle.customer_id !== customerId) {
      throw new UnprocessableEntityException(
        'Vehicle does not belong to the selected customer.',
      );
    }
  }

  private async assertLocationOnSite(
    tenantId: string,
    siteId: string,
    locationId: string,
  ) {
    const location = await this.prisma.storageLocation.findFirst({
      where: {
        id: locationId,
        tenant_id: tenantId,
        site_id: siteId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!location) {
      throw new UnprocessableEntityException(
        'Storage location must belong to the active site.',
      );
    }
  }

  private async assertWorkshopOrder(
    tenantId: string,
    siteId: string,
    workshopOrderId: string,
  ) {
    const order = await this.prisma.workshopOrder.findFirst({
      where: {
        id: workshopOrderId,
        tenant_id: tenantId,
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

  private toSettingsResponse(
    settings: Prisma.TyreStorageSettingsGetPayload<object>,
  ): TyreStorageSettingsResponseDto {
    return {
      summerSwapMonth: settings.summer_swap_month,
      summerSwapDay: settings.summer_swap_day,
      winterSwapMonth: settings.winter_swap_month,
      winterSwapDay: settings.winter_swap_day,
      dueForSwapDays: settings.due_for_swap_days,
    };
  }

  private toResponse(row: TyreSetWithRelations): TyreSetResponseDto {
    return {
      id: row.id,
      customerId: row.customer_id,
      vehicleId: row.vehicle_id,
      siteId: row.site_id,
      locationId: row.location_id,
      locationCode: row.location?.code ?? null,
      label: row.label,
      season: row.season,
      tyreCount: row.tyre_count,
      rimType: row.rim_type,
      brand: row.brand,
      model: row.model,
      dimension: row.dimension,
      dotCodes: row.dot_codes,
      treadDepthMm: row.tread_depth_mm_json as Record<string, number> | null,
      conditionNotes: row.condition_notes,
      status: row.status,
      storedSince: row.stored_since?.toISOString().slice(0, 10) ?? null,
      plannedSwapOn: row.planned_swap_on?.toISOString().slice(0, 10) ?? null,
      binLabel: row.bin_label,
      customerName: `${row.customer.first_name} ${row.customer.last_name}`,
      customerPhone: row.customer.phone,
      customerEmail: row.customer.email,
      vehiclePlate: row.vehicle?.plate ?? null,
      events: row.events?.map((event) => ({
        id: event.id,
        eventType: event.event_type,
        occurredAt: event.occurred_at.toISOString(),
        workshopOrderId: event.workshop_order_id,
        fromLocationId: event.from_location_id,
        toLocationId: event.to_location_id,
        odometer: event.odometer,
        note: event.note,
      })),
    };
  }
}

function csvEscape(value: string): string {
  const escaped =
    value.startsWith('=') ||
    value.startsWith('+') ||
    value.startsWith('-') ||
    value.startsWith('@')
      ? `'${value}`
      : value;
  if (
    escaped.includes(',') ||
    escaped.includes('"') ||
    escaped.includes('\n')
  ) {
    return `"${escaped.replaceAll('"', '""')}"`;
  }
  return escaped;
}
