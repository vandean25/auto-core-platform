import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type {
  LegalEntityCountry,
  Site,
  WorkshopOpeningHour,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpdateWorkshopSettingsDto,
  WorkshopOpeningHourDto,
  WorkshopSettingsResponseDto,
} from './dto/workshop-settings.dto';
import {
  DEFAULT_OPENING_HOURS,
  SLOT_MINUTES,
  isOpenWindowValid,
  isValidIanaTimeZone,
} from './workshop-hours.defaults';

type SiteWithHours = Site & {
  openingHours: WorkshopOpeningHour[];
};

/**
 * Tenant-singleton WorkshopSettings was replaced by per-site planner fields
 * (ADR-0022 / ruling 20, 56). The GET/PUT /api/workshop/settings routes keep
 * their shape but now read/write the tenant's MAIN Site. Legacy single-site
 * tenants get exactly one MAIN Site from the backfill migration, so the
 * existing planner/schedule/holiday code keeps working unchanged.
 */
@Injectable()
export class WorkshopSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getSettings(): Promise<WorkshopSettingsResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const settings = await this.getOrCreateSettings(tenantId);
    return this.toResponse(settings);
  }

  async updateSettings(
    dto: UpdateWorkshopSettingsDto,
  ): Promise<WorkshopSettingsResponseDto> {
    this.assertTenantAdminAccess();
    this.assertValidUpdate(dto);

    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.getOrCreateSettings(tenantId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.site.update({
        where: { id: existing.id },
        data: {
          timezone: dto.timezone,
          slot_minutes: dto.slotMinutes,
          holiday_country_iso: dto.holidayCountryIso,
          holiday_subdivision_code: dto.holidaySubdivisionCode ?? null,
        },
      });

      for (const hour of dto.openingHours) {
        await tx.workshopOpeningHour.updateMany({
          where: {
            tenant_id: tenantId,
            site_id: existing.id,
            weekday: hour.weekday,
          },
          data: {
            is_closed: hour.isClosed,
            open_time: hour.openTime,
            close_time: hour.closeTime,
          },
        });
      }

      return tx.site.findFirstOrThrow({
        where: { id: existing.id },
        include: { openingHours: { orderBy: { weekday: 'asc' } } },
      });
    });

    return this.toResponse(updated);
  }

  /**
   * Resolves the tenant's MAIN Site (the default backfilled site). Creates a
   * LegalEntity + MAIN Site lazily when the tenant has none so legacy tenants
   * that never ran the backfill still work.
   */
  async getOrCreateSettings(tenantId: string): Promise<SiteWithHours> {
    const existing = await this.prisma.site.findFirst({
      where: { tenant_id: tenantId, code: 'MAIN' },
      include: { openingHours: { orderBy: { weekday: 'asc' } } },
    });

    if (existing) {
      if (!existing.is_active) {
        throw new BadRequestException(
          'The MAIN site is inactive and must be reactivated before workshop settings can be used.',
        );
      }
      if (existing.openingHours.length === 7) {
        return existing;
      }
      return this.ensureSevenOpeningHours(tenantId, existing);
    }

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { name: true },
      });

      const legalEntity = await tx.legalEntity.create({
        data: {
          tenant_id: tenantId,
          name: tenant?.name ?? 'Default',
          country_iso: 'AT' satisfies LegalEntityCountry,
          is_active: true,
        },
      });

      const site = await tx.site.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: legalEntity.id,
          code: 'MAIN',
          name: tenant?.name ?? 'Default',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
          is_active: true,
        },
      });

      await tx.workshopOpeningHour.createMany({
        data: DEFAULT_OPENING_HOURS.map((hour) => ({
          tenant_id: tenantId,
          site_id: site.id,
          weekday: hour.weekday,
          is_closed: hour.isClosed,
          open_time: hour.openTime,
          close_time: hour.closeTime,
        })),
        skipDuplicates: true,
      });

      await tx.storageLocation.createMany({
        data: [
          {
            tenant_id: tenantId,
            site_id: site.id,
            code: 'TRANSIT',
            name: 'In Transit',
            type: 'in_transit',
            is_system: true,
          },
          {
            tenant_id: tenantId,
            site_id: site.id,
            code: 'LOT',
            name: 'Vehicle Lot',
            type: 'vehicle_lot',
            is_system: false,
          },
        ],
        skipDuplicates: true,
      });

      return tx.site.findFirstOrThrow({
        where: { id: site.id },
        include: { openingHours: { orderBy: { weekday: 'asc' } } },
      });
    });
  }

  private async ensureSevenOpeningHours(
    tenantId: string,
    site: Site,
  ): Promise<SiteWithHours> {
    await this.prisma.$transaction(async (tx) => {
      const existingWeekdays = new Set(
        (
          await tx.workshopOpeningHour.findMany({
            where: { tenant_id: tenantId, site_id: site.id },
            select: { weekday: true },
          })
        ).map((row) => row.weekday),
      );

      const missing = DEFAULT_OPENING_HOURS.filter(
        (hour) => !existingWeekdays.has(hour.weekday),
      );

      if (missing.length > 0) {
        await tx.workshopOpeningHour.createMany({
          data: missing.map((hour) => ({
            tenant_id: tenantId,
            site_id: site.id,
            weekday: hour.weekday,
            is_closed: hour.isClosed,
            open_time: hour.openTime,
            close_time: hour.closeTime,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.prisma.site.findFirstOrThrow({
      where: { id: site.id },
      include: { openingHours: { orderBy: { weekday: 'asc' } } },
    });
  }

  private assertValidUpdate(dto: UpdateWorkshopSettingsDto): void {
    if (!isValidIanaTimeZone(dto.timezone)) {
      throw new BadRequestException(`Invalid timezone '${dto.timezone}'`);
    }

    if (!SLOT_MINUTES.includes(dto.slotMinutes)) {
      throw new BadRequestException('slotMinutes must be 15, 30, or 60');
    }

    const weekdays = dto.openingHours.map((hour) => hour.weekday);
    const uniqueWeekdays = new Set(weekdays);
    if (
      dto.openingHours.length !== 7 ||
      uniqueWeekdays.size !== 7 ||
      weekdays.some((day) => day < 1 || day > 7)
    ) {
      throw new BadRequestException(
        'openingHours must include each weekday 1–7 exactly once',
      );
    }

    for (const hour of dto.openingHours) {
      if (!hour.isClosed && !isOpenWindowValid(hour.openTime, hour.closeTime)) {
        throw new BadRequestException(
          `Weekday ${hour.weekday} closeTime must be after openTime`,
        );
      }
    }
  }

  private assertTenantAdminAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }

  private toResponse(settings: SiteWithHours): WorkshopSettingsResponseDto {
    return {
      timezone: settings.timezone,
      slotMinutes: settings.slot_minutes as (typeof SLOT_MINUTES)[number],
      holidayCountryIso: settings.holiday_country_iso,
      holidaySubdivisionCode: settings.holiday_subdivision_code,
      openingHours: settings.openingHours.map(
        (hour): WorkshopOpeningHourDto => ({
          weekday: hour.weekday,
          isClosed: hour.is_closed,
          openTime: hour.open_time,
          closeTime: hour.close_time,
        }),
      ),
    };
  }
}
