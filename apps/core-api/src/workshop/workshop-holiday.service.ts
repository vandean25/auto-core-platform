import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkshopHoliday, WorkshopHolidaySource } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateWorkshopHolidayDto,
  ImportWorkshopHolidaysDto,
  ImportWorkshopHolidaysResponseDto,
  UpdateWorkshopHolidayDto,
  WorkshopHolidayDto,
} from './dto/workshop-holiday.dto';
import {
  OPENHOLIDAYS_FETCH,
  OpenHolidaysTimeoutError,
  OpenHolidaysUnavailableError,
  fetchPublicHolidays,
  type OpenHolidaysFetch,
  type PublicHolidayDay,
} from './openholidays.client';
import { isOpenWindowValid } from './workshop-hours.defaults';
import { WorkshopSettingsService } from './workshop-settings.service';

type HolidayCollisionRow = {
  id: string;
  observed_on: Date;
  repeats_annually: boolean;
};

export function toUtcDateOnly(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new BadRequestException('observedOn must be YYYY-MM-DD');
  }
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
}

export function formatUtcDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function calendarDateQuery(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (Array.isArray(value) || typeof value !== 'string') {
    throw new BadRequestException(
      `${field} must be a single YYYY-MM-DD string`,
    );
  }
  return value.slice(0, 10);
}

export function monthDayKey(value: Date): string {
  return `${value.getUTCMonth() + 1}-${value.getUTCDate()}`;
}

export function holidayCollides(
  existing: HolidayCollisionRow[],
  candidate: { observedOn: Date; repeatsAnnually: boolean },
  excludeId?: string,
): boolean {
  const candidateKey = monthDayKey(candidate.observedOn);
  const candidateDate = formatUtcDateOnly(candidate.observedOn);

  return existing.some((row) => {
    if (excludeId && row.id === excludeId) {
      return false;
    }
    const rowDate = formatUtcDateOnly(row.observed_on);
    const rowKey = monthDayKey(row.observed_on);
    if (!row.repeats_annually && !candidate.repeatsAnnually) {
      return rowDate === candidateDate;
    }
    return rowKey === candidateKey;
  });
}

@Injectable()
export class WorkshopHolidayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly settingsService: WorkshopSettingsService,
    @Inject(OPENHOLIDAYS_FETCH)
    private readonly openHolidaysFetch: OpenHolidaysFetch,
  ) {}

  async listHolidays(
    from?: string,
    to?: string,
  ): Promise<{ data: WorkshopHolidayDto[] }> {
    const tenantId = await this.tenantContext.getTenantId();
    const settings = await this.settingsService.getOrCreateSettings(tenantId);
    const range = this.resolveListRange(settings.timezone, from, to);

    const rows = await this.prisma.workshopHoliday.findMany({
      where: {
        tenant_id: tenantId,
        OR: [
          {
            repeats_annually: false,
            observed_on: {
              gte: toUtcDateOnly(range.from),
              lte: toUtcDateOnly(range.to),
            },
          },
          { repeats_annually: true },
        ],
      },
      orderBy: [{ observed_on: 'asc' }, { name: 'asc' }],
    });

    return { data: rows.map((row) => this.toDto(row)) };
  }

  async createHoliday(
    dto: CreateWorkshopHolidayDto,
  ): Promise<WorkshopHolidayDto> {
    this.assertTenantAdminAccess();
    const isClosed = dto.isClosed ?? true;
    this.assertHolidayWindow(isClosed, dto.openTime, dto.closeTime);

    const tenantId = await this.tenantContext.getTenantId();
    const settings = await this.settingsService.getOrCreateSettings(tenantId);
    const observedOn = toUtcDateOnly(dto.observedOn.slice(0, 10));
    const repeatsAnnually = dto.repeatsAnnually ?? false;

    await this.assertNoCollision(tenantId, {
      observedOn,
      repeatsAnnually,
    });

    const created = await this.prisma.workshopHoliday.create({
      data: {
        tenant_id: tenantId,
        workshop_settings_id: settings.id,
        name: dto.name.trim(),
        observed_on: observedOn,
        repeats_annually: repeatsAnnually,
        is_closed: isClosed,
        open_time: isClosed ? null : (dto.openTime ?? null),
        close_time: isClosed ? null : (dto.closeTime ?? null),
        source: WorkshopHolidaySource.MANUAL,
      },
    });

    return this.toDto(created);
  }

  async updateHoliday(
    id: string,
    dto: UpdateWorkshopHolidayDto,
  ): Promise<WorkshopHolidayDto> {
    this.assertTenantAdminAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.workshopHoliday.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Holiday ${id} not found`);
    }

    const isClosed = dto.isClosed ?? existing.is_closed;
    const openTime =
      dto.openTime === undefined ? existing.open_time : dto.openTime;
    const closeTime =
      dto.closeTime === undefined ? existing.close_time : dto.closeTime;
    this.assertHolidayWindow(
      isClosed,
      openTime ?? undefined,
      closeTime ?? undefined,
    );

    const observedOn = dto.observedOn
      ? toUtcDateOnly(dto.observedOn.slice(0, 10))
      : existing.observed_on;
    const repeatsAnnually = dto.repeatsAnnually ?? existing.repeats_annually;

    await this.assertNoCollision(
      tenantId,
      { observedOn, repeatsAnnually },
      existing.id,
    );

    const updated = await this.prisma.workshopHoliday.update({
      where: { id: existing.id },
      data: {
        name: dto.name?.trim() ?? existing.name,
        observed_on: observedOn,
        repeats_annually: repeatsAnnually,
        is_closed: isClosed,
        open_time: isClosed ? null : openTime,
        close_time: isClosed ? null : closeTime,
      },
    });

    return this.toDto(updated);
  }

  async deleteHoliday(id: string): Promise<void> {
    this.assertTenantAdminAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const deleted = await this.prisma.workshopHoliday.deleteMany({
      where: { id, tenant_id: tenantId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException(`Holiday ${id} not found`);
    }
  }

  async importPublicHolidays(
    dto: ImportWorkshopHolidaysDto,
  ): Promise<ImportWorkshopHolidaysResponseDto> {
    this.assertTenantAdminAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const settings = await this.settingsService.getOrCreateSettings(tenantId);
    const yearFrom = this.calendarYear(settings.timezone);
    const yearTo = yearFrom + 1;
    const countryIsoCode = dto.countryIsoCode ?? settings.holiday_country_iso;
    const subdivisionCode =
      dto.subdivisionCode === undefined
        ? settings.holiday_subdivision_code
        : dto.subdivisionCode;

    let days: PublicHolidayDay[];
    try {
      days = await fetchPublicHolidays(
        {
          countryIsoCode,
          subdivisionCode,
          validFrom: `${yearFrom}-01-01`,
          validTo: `${yearTo}-12-31`,
        },
        this.openHolidaysFetch,
      );
    } catch (error) {
      if (
        error instanceof OpenHolidaysTimeoutError ||
        error instanceof OpenHolidaysUnavailableError
      ) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }

    const existing = await this.prisma.workshopHoliday.findMany({
      where: { tenant_id: tenantId },
    });
    const existingByDate = new Map(
      existing.map((row) => [formatUtcDateOnly(row.observed_on), row]),
    );

    let imported = 0;
    let skipped = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const day of days) {
        const current = existingByDate.get(day.observedOn);
        if (current?.source === WorkshopHolidaySource.MANUAL) {
          skipped += 1;
          continue;
        }
        if (current) {
          await tx.workshopHoliday.update({
            where: { id: current.id },
            data: {
              name: day.name,
              external_id: day.externalId,
              source: WorkshopHolidaySource.IMPORTED,
            },
          });
          skipped += 1;
          continue;
        }
        await tx.workshopHoliday.create({
          data: {
            tenant_id: tenantId,
            workshop_settings_id: settings.id,
            name: day.name,
            observed_on: toUtcDateOnly(day.observedOn),
            repeats_annually: false,
            is_closed: true,
            source: WorkshopHolidaySource.IMPORTED,
            external_id: day.externalId,
          },
        });
        imported += 1;
      }
    });

    return { imported, skipped, yearFrom, yearTo };
  }

  private async assertNoCollision(
    tenantId: string,
    candidate: { observedOn: Date; repeatsAnnually: boolean },
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.workshopHoliday.findMany({
      where: { tenant_id: tenantId },
      select: { id: true, observed_on: true, repeats_annually: true },
    });
    if (holidayCollides(existing, candidate, excludeId)) {
      throw new ConflictException(
        'A holiday already exists for that date after annual expansion',
      );
    }
  }

  private assertHolidayWindow(
    isClosed: boolean,
    openTime?: string | null,
    closeTime?: string | null,
  ): void {
    if (isClosed) {
      return;
    }
    if (!openTime || !closeTime || !isOpenWindowValid(openTime, closeTime)) {
      throw new BadRequestException(
        'Short holidays require openTime and closeTime with closeTime after openTime',
      );
    }
  }

  private calendarYear(timeZone: string): number {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
      }).format(new Date()),
    );
  }

  private resolveListRange(
    timeZone: string,
    from?: string,
    to?: string,
  ): { from: string; to: string } {
    const fromDate = calendarDateQuery(from, 'from');
    const toDate = calendarDateQuery(to, 'to');
    if (fromDate && toDate) {
      return { from: fromDate, to: toDate };
    }
    const year = this.calendarYear(timeZone);
    return { from: `${year}-01-01`, to: `${year + 1}-12-31` };
  }

  private assertTenantAdminAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }

  private toDto(row: WorkshopHoliday): WorkshopHolidayDto {
    return {
      id: row.id,
      name: row.name,
      observedOn: formatUtcDateOnly(row.observed_on),
      repeatsAnnually: row.repeats_annually,
      isClosed: row.is_closed,
      openTime: row.open_time,
      closeTime: row.close_time,
      source: row.source,
    };
  }
}
