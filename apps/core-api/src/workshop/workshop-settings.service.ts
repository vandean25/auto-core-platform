import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { WorkshopOpeningHour, WorkshopSettings } from '@prisma/client';
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

type SettingsWithHours = WorkshopSettings & {
  openingHours: WorkshopOpeningHour[];
};

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
      await tx.workshopSettings.update({
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
          where: { tenant_id: tenantId, weekday: hour.weekday },
          data: {
            is_closed: hour.isClosed,
            open_time: hour.openTime,
            close_time: hour.closeTime,
          },
        });
      }

      return tx.workshopSettings.findFirstOrThrow({
        where: { id: existing.id },
        include: { openingHours: { orderBy: { weekday: 'asc' } } },
      });
    });

    return this.toResponse(updated);
  }

  async getOrCreateSettings(tenantId: string): Promise<SettingsWithHours> {
    const existing = await this.prisma.workshopSettings.findFirst({
      where: { tenant_id: tenantId },
      include: { openingHours: { orderBy: { weekday: 'asc' } } },
    });

    if (existing && existing.openingHours.length === 7) {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const settings =
        existing ??
        (await tx.workshopSettings.create({
          data: { tenant_id: tenantId },
        }));

      if (!existing || existing.openingHours.length !== 7) {
        await tx.workshopOpeningHour.createMany({
          data: DEFAULT_OPENING_HOURS.map((hour) => ({
            tenant_id: tenantId,
            workshop_settings_id: settings.id,
            weekday: hour.weekday,
            is_closed: hour.isClosed,
            open_time: hour.openTime,
            close_time: hour.closeTime,
          })),
          skipDuplicates: true,
        });
      }

      return tx.workshopSettings.findFirstOrThrow({
        where: { id: settings.id },
        include: { openingHours: { orderBy: { weekday: 'asc' } } },
      });
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

  private toResponse(settings: SettingsWithHours): WorkshopSettingsResponseDto {
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
