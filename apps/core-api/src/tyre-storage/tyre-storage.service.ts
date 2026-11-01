import {
  BadRequestException,
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
  assertTyreStorageInspect,
  assertTyreStorageRead,
  assertTyreStorageWrite,
} from './tyre-storage-access.js';
import {
  derivePlannedSwapOn,
  isDueForSwap,
} from './tyre-storage-season.helpers.js';
import { applyTyreSetEvent } from './tyre-set-event.helpers.js';
import { TyreStorageClock } from './tyre-storage.clock.js';
import { validateTyreThresholdOverrides } from '../tyre-measurement/tyre-thresholds.js';
import { createTyreMeasurementRow } from '../tyre-measurement/tyre-measurement-create.js';
import { toTyreMeasurementResponse } from '../tyre-measurement/tyre-measurement-response.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import {
  loadLatestTyreMeasurements,
  type TyreMeasurementWithWheels,
} from './tyre-set-latest-measurement.js';
import { queryTyreSetsForList } from './tyre-set-list.read.js';
import { toTyreSetListRowDto } from './tyre-set-list.mapper.js';
import type { TyreSetListQueryDto } from './dto/tyre-set-list-query.dto.js';
import type {
  CreateTyreSetDto,
  TyreSetLocationActionDto,
  TyreSetResponseDto,
  UpdateTyreSetDto,
  UpdateTyreStorageSettingsDto,
  TyreStorageSettingsResponseDto,
} from './dto/tyre-set.dto.js';
import type { CreateTyreWheelDto } from '../tyre-measurement/tyre-measurement.dto.js';

type LocationEventType =
  'CHECK_IN' | 'CHECK_OUT' | 'MOVED' | 'DISPOSED' | 'INSPECTED';

const MEASURED_EVENT_TYPES: readonly LocationEventType[] = [
  'CHECK_IN',
  'CHECK_OUT',
  'INSPECTED',
];

type LocationEventDraft = {
  tenantId: string;
  siteId: string;
  set: TyreSet;
  eventType: LocationEventType;
  occurredAt: Date;
  toLocationId: string | null;
  wheels: CreateTyreWheelDto[];
  dto: TyreSetLocationActionDto;
  userId: string | null;
  actorId: string | null;
};

type EventTargetRequest = {
  tenantId: string;
  siteId: string;
  id: string;
  eventType: LocationEventType;
  dto: TyreSetLocationActionDto;
  wheels: CreateTyreWheelDto[];
};

type TyreSetWithRelations = TyreSet & {
  customer: {
    first_name: string;
    last_name: string;
    phone: string | null;
    email: string | null;
  };
  vehicle: { plate: string | null } | null;
  location: { code: string } | null;
  events?: TyreSetEvent[];
  latestMeasurement?: TyreMeasurementWithWheels | null;
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
    let overrides;
    if (dto.recommendationOverrides !== undefined) {
      try {
        overrides = validateTyreThresholdOverrides(dto.recommendationOverrides);
      } catch {
        throw new BadRequestException({ code: 'TYRE_THRESHOLDS_INVALID' });
      }
    }
    const values = {
      summer_swap_month: dto.summerSwapMonth,
      summer_swap_day: dto.summerSwapDay,
      winter_swap_month: dto.winterSwapMonth,
      winter_swap_day: dto.winterSwapDay,
      due_for_swap_days: dto.dueForSwapDays,
      ...(overrides === undefined
        ? {}
        : { recommendation_overrides: overrides }),
    };
    const updated = await this.prisma.tyreStorageSettings.upsert({
      where: { tenant_id: tenantId },
      create: { tenant_id: tenantId, ...values },
      update: values,
    });
    return this.toSettingsResponse(updated);
  }

  async list(query: TyreSetListQueryDto) {
    assertTyreStorageRead(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const result = await queryTyreSetsForList(
      this.prisma,
      tenantId,
      siteId,
      query,
      toTyreSetListRowDto,
    );
    const latest = await loadLatestTyreMeasurements(
      this.prisma,
      { tenantId, siteId },
      result.data.map((row) => row.id),
    );
    return {
      ...result,
      data: result.data.map((row) =>
        withLatestMeasurement(row, latest.get(row.id)),
      ),
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

    const filtered = rows.filter((row) =>
      isDueForSwap(row.planned_swap_on, settings.due_for_swap_days, asOf),
    );
    const latest = await loadLatestTyreMeasurements(
      this.prisma,
      { tenantId, siteId },
      filtered.map((row) => row.id),
    );

    return {
      data: filtered.map((row) => this.toResponse(row, latest.get(row.id))),
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
    const latest = await loadLatestTyreMeasurements(
      this.prisma,
      { tenantId, siteId },
      rows.map((row) => row.id),
    );
    return {
      data: rows.map((row) => this.toResponse(row, latest.get(row.id))),
    };
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
    const latest = await loadLatestTyreMeasurements(
      this.prisma,
      { tenantId, siteId },
      [id],
    );
    return this.toResponse(row, latest.get(id));
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
          status: dto.locationId ? 'IN_STORAGE' : 'NEW',
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

  /** Condition-only ledger entry; technicians may record it. */
  async inspect(id: string, dto: TyreSetLocationActionDto) {
    return this.recordLocationEvent(id, 'INSPECTED', dto);
  }

  private async recordLocationEvent(
    id: string,
    eventType: LocationEventType,
    dto: TyreSetLocationActionDto,
  ) {
    if (eventType === 'INSPECTED') {
      assertTyreStorageInspect(this.tenantContext);
    } else {
      assertTyreStorageWrite(this.tenantContext);
    }
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const occurredAt = dto.occurredAt
      ? new Date(dto.occurredAt)
      : this.clock.now();
    const wheels = dto.wheels ?? [];
    assertLocationEventPayload(eventType, wheels);
    const { set, toLocationId } = await this.resolveEventTarget({
      tenantId,
      siteId,
      id,
      eventType,
      dto,
      wheels,
    });
    await this.assertEventReferences(tenantId, set, dto, wheels.length > 0);
    const actor = wheels.length
      ? await requireActiveCurrentUser(
          this.prisma,
          this.tenantContext,
          tenantId,
        )
      : null;

    await this.prisma.$transaction((tx) =>
      this.writeLocationEvent(tx, {
        tenantId,
        siteId,
        set,
        eventType,
        occurredAt,
        toLocationId,
        wheels,
        dto,
        userId: this.tenantContext.getAuthenticatedUser()?.userId ?? null,
        actorId: actor?.id ?? null,
      }),
    );

    return this.findOne(id);
  }

  private async resolveEventTarget(
    request: EventTargetRequest,
  ): Promise<{ set: TyreSet; toLocationId: string | null }> {
    const { tenantId, siteId, id, eventType, dto, wheels } = request;
    const set = await this.prisma.tyreSet.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    if (!set) {
      throw new NotFoundException(`Tyre set ${id} not found`);
    }
    if (wheels.length > 0 && !set.vehicle_id) {
      throw new UnprocessableEntityException({
        code: 'TYRE_MEASUREMENT_VEHICLE_REQUIRED',
      });
    }
    const toLocationId = resolveEventLocationId(
      eventType,
      set.location_id,
      dto.locationId,
    );
    if (toLocationId) {
      await this.assertLocationOnSite(tenantId, set.site_id, toLocationId);
    }
    return { set, toLocationId };
  }

  private async assertEventReferences(
    tenantId: string,
    set: TyreSet,
    dto: TyreSetLocationActionDto,
    measuring: boolean,
  ): Promise<void> {
    if (dto.workshopOrderId) {
      const order = await this.assertWorkshopOrder(
        tenantId,
        set.site_id,
        dto.workshopOrderId,
      );
      if (measuring && order.vehicle_id !== set.vehicle_id) {
        throw new UnprocessableEntityException({
          code: 'TYRE_MEASUREMENT_ORDER_MISMATCH',
        });
      }
    }
    if (dto.employeeId) {
      await this.assertEmployee(tenantId, dto.employeeId);
    }
  }

  private async writeLocationEvent(
    tx: Prisma.TransactionClient,
    draft: LocationEventDraft,
  ): Promise<void> {
    const { tenantId, set } = draft;
    await lockMeasuredSite(tx, draft);
    await this.assertEventTimeline(tx, tenantId, set.id, draft.occurredAt);
    await this.applyLocationEvent(tx, draft);
    const event = await tx.tyreSetEvent.create({
      data: locationEventData(draft),
    });
    await this.writeEventMeasurement(tx, draft, event.id);
  }

  private async applyLocationEvent(
    tx: Prisma.TransactionClient,
    draft: LocationEventDraft,
  ): Promise<void> {
    const { tenantId, siteId, set, dto } = draft;
    const patch = applyTyreSetEvent(
      set,
      draft.eventType,
      draft.toLocationId,
      draft.occurredAt,
    );
    const updated = await tx.tyreSet.updateMany({
      where: {
        id: set.id,
        tenant_id: tenantId,
        site_id: siteId,
        status: set.status,
        location_id: set.location_id,
      },
      data: {
        status: patch.status,
        location_id: patch.location_id,
        stored_since: patch.stored_since,
        tread_depth_mm_json: dto.treadDepthMm as Prisma.InputJsonValue,
      },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        'Tyre set status changed concurrently. Please refresh.',
      );
    }
  }

  private async writeEventMeasurement(
    tx: Prisma.TransactionClient,
    draft: LocationEventDraft,
    eventId: string,
  ): Promise<void> {
    const { tenantId, set, wheels, actorId } = draft;
    if (wheels.length === 0 || !actorId || !set.vehicle_id) return;
    await createTyreMeasurementRow(tx, {
      scope: { tenantId, siteId: set.site_id },
      vehicleId: set.vehicle_id,
      workshopOrderId: draft.dto.workshopOrderId ?? null,
      tyreSetId: set.id,
      tyreSetEventId: eventId,
      measuredAt: draft.occurredAt,
      actorId,
      wheels,
      weightClass: draft.dto.weightClass,
    });
  }

  private async assertEventTimeline(
    tx: Prisma.TransactionClient,
    tenantId: string,
    tyreSetId: string,
    occurredAt: Date,
  ): Promise<void> {
    const latestEvent = await tx.tyreSetEvent.findFirst({
      where: { tenant_id: tenantId, tyre_set_id: tyreSetId },
      orderBy: { occurred_at: 'desc' },
      select: { occurred_at: true },
    });
    if (occurredAt.getTime() > this.clock.now().getTime()) {
      throw new UnprocessableEntityException(
        'occurredAt cannot be in the future.',
      );
    }
    if (
      latestEvent &&
      occurredAt.getTime() < latestEvent.occurred_at.getTime()
    ) {
      throw new UnprocessableEntityException(
        'occurredAt cannot be earlier than the latest event.',
      );
    }
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
      select: { id: true, vehicle_id: true },
    });
    if (!order) {
      throw new NotFoundException(
        `Workshop order ${workshopOrderId} not found`,
      );
    }
    return order;
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
      recommendationOverrides: validateTyreThresholdOverrides(
        settings.recommendation_overrides ?? {},
      ),
    };
  }

  private toResponse(
    row: TyreSetWithRelations,
    latestMeasurement?: TyreMeasurementWithWheels,
  ): TyreSetResponseDto {
    return {
      ...withLatestMeasurement(toTyreSetListRowDto(row), latestMeasurement),
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

function withLatestMeasurement(
  row: TyreSetResponseDto,
  measurement: TyreMeasurementWithWheels | undefined,
): TyreSetResponseDto {
  return {
    ...row,
    latestMeasurement: measurement
      ? toTyreMeasurementResponse(measurement)
      : null,
  };
}

async function lockMeasuredSite(
  tx: Prisma.TransactionClient,
  draft: LocationEventDraft,
): Promise<void> {
  if (draft.wheels.length === 0) return;
  await lockSitesAndAssertActive(tx, draft.tenantId, [draft.set.site_id]);
}

function locationEventData(
  draft: LocationEventDraft,
): Prisma.TyreSetEventUncheckedCreateInput {
  const { tenantId, set, dto } = draft;
  return {
    tenant_id: tenantId,
    tyre_set_id: set.id,
    event_type: draft.eventType,
    occurred_at: draft.occurredAt,
    workshop_order_id: dto.workshopOrderId,
    from_location_id: set.location_id,
    to_location_id: draft.toLocationId,
    odometer: dto.odometer,
    tread_depth_mm_json: dto.treadDepthMm as Prisma.InputJsonValue,
    note: dto.note,
    employee_id: dto.employeeId,
    created_by_user_id: draft.userId,
  };
}

function assertLocationEventPayload(
  eventType: LocationEventType,
  wheels: CreateTyreWheelDto[],
): void {
  if (wheels.length > 0 && !MEASURED_EVENT_TYPES.includes(eventType)) {
    throw new BadRequestException({
      code: 'TYRE_MEASUREMENT_EVENT_INVALID',
    });
  }
  if (wheels.some((wheel) => wheel.mediaId)) {
    throw new BadRequestException({
      code: 'TYRE_MEASUREMENT_MEDIA_INVALID',
    });
  }
}

function resolveEventLocationId(
  eventType: LocationEventType,
  currentLocationId: string | null,
  requestedLocationId: string | undefined,
): string | null {
  if (eventType === 'CHECK_OUT' || eventType === 'DISPOSED') return null;
  if (eventType === 'INSPECTED') return currentLocationId;
  const requiredTarget = requestedLocationId ?? currentLocationId;
  if (!requiredTarget) {
    throw new UnprocessableEntityException('locationId is required');
  }
  if (eventType === 'MOVED' && requiredTarget === currentLocationId) {
    throw new UnprocessableEntityException(
      'Destination must differ from the current location.',
    );
  }
  return requiredTarget;
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
