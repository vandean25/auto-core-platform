import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkshopHoliday, WorkshopHolidaySource } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateWorkshopHolidayDto,
  UpdateWorkshopHolidayDto,
  WorkshopHolidayDto,
} from './dto/workshop-holiday.dto';
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
  ) {}

  async listHolidays(from?: string, to?: string): Promise<{ data: WorkshopHolidayDto[] }> {
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

  async createHoliday(dto: CreateWorkshopHolidayDto): Promise<WorkshopHolidayDto> {
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
    const openTime = dto.openTime === undefined ? existing.open_time : dto.openTime;
    const closeTime =
      dto.closeTime === undefined ? existing.close_time : dto.closeTime;
    this.assertHolidayWindow(isClosed, openTime ?? undefined, closeTime ?? undefined);

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

  private resolveListRange(
    timeZone: string,
    from?: string,
    to?: string,
  ): { from: string; to: string } {
    if (from && to) {
      return { from: from.slice(0, 10), to: to.slice(0, 10) };
    }
    const year = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
      }).format(new Date()),
    );
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
