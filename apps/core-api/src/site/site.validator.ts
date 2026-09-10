import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DEFAULT_OPENING_HOURS } from '../workshop/workshop-hours.defaults';
import {
  CreateLegalEntityDto,
  CreateSiteDto,
  SUPPORTED_LEGAL_ENTITY_COUNTRIES,
  UpdateSiteDto,
} from './dto/site.dto';
import { SYSTEM_LOCATION_TYPE, TIMEZONE_BY_COUNTRY } from './site.constants';

export type ResolvedSiteCreateDefaults = {
  timezone: string;
  holidayCountry: string;
  slotMinutes: number;
  openingHours: readonly {
    weekday: number;
    isClosed: boolean;
    openTime: string;
    closeTime: string;
  }[];
};

export function validateLegalEntityCreateInput(
  dto: CreateLegalEntityDto,
  existing: { id: string } | null,
): void {
  const countryIso = dto.countryIso;
  if (!SUPPORTED_LEGAL_ENTITY_COUNTRIES.includes(countryIso)) {
    throw new BadRequestException(
      `countryIso must be one of ${SUPPORTED_LEGAL_ENTITY_COUNTRIES.join(', ')}`,
    );
  }

  if (existing) {
    throw new ConflictException(
      'A legal entity with that name already exists in this tenant.',
    );
  }
}

export function validateSiteCreateInput(
  dto: CreateSiteDto,
  legalEntityCountry: string,
): ResolvedSiteCreateDefaults {
  const country = legalEntityCountry;
  const timezone =
    dto.timezone ?? TIMEZONE_BY_COUNTRY[country] ?? 'Europe/Vienna';
  const holidayCountry = dto.holidayCountryIso ?? country;
  const slotMinutes = dto.slotMinutes ?? 30;
  const openingHours: readonly {
    weekday: number;
    isClosed: boolean;
    openTime: string;
    closeTime: string;
  }[] = dto.openingHours ?? DEFAULT_OPENING_HOURS;

  const weekdays = openingHours
    .map((hour) => hour.weekday)
    .sort((a, b) => a - b);
  if (
    weekdays.length !== 7 ||
    weekdays.some((weekday, index) => weekday !== index + 1)
  ) {
    throw new BadRequestException(
      'openingHours must contain exactly one entry for each weekday 1 through 7',
    );
  }
  for (const hour of openingHours) {
    if (!hour.isClosed && hour.closeTime <= hour.openTime) {
      throw new BadRequestException(
        `closeTime must be after openTime for weekday ${hour.weekday}`,
      );
    }
  }

  return {
    timezone,
    holidayCountry,
    slotMinutes,
    openingHours,
  };
}

export function assertSiteUpdatePayloadValid(dto: UpdateSiteDto): void {
  const attemptedLegalEntityChange = (dto as { legalEntityId?: unknown })
    .legalEntityId;
  if (attemptedLegalEntityChange !== undefined) {
    throw new BadRequestException(
      'Site.legal_entity_id is immutable and cannot be changed.',
    );
  }
}

export function validateSiteUpdateInput(
  dto: UpdateSiteDto,
  existingSite: { id: string; is_active: boolean; legal_entity_id: string },
  parentLegalEntityActive?: boolean,
): void {
  assertSiteUpdatePayloadValid(dto);

  if (
    dto.isActive === true &&
    !existingSite.is_active &&
    !parentLegalEntityActive
  ) {
    throw new UnprocessableEntityException(
      'Cannot reactivate a site whose legal entity is inactive. Reactivate the entity first.',
    );
  }

  if (dto.isActive === false) {
    throw new ConflictException(
      'Site deactivation is not yet available: it requires the serialized deactivation guard (ruling 41) which ships with the SiteContext follow-up.',
    );
  }
}

export function assertSiteDeletable(
  site: {
    _count: { memberships: number; bays: number };
    storageLocations: { is_system: boolean; type: string }[];
  },
  parkedVehiclesCount: number,
): boolean {
  if (site._count.memberships > 0) {
    throw new ConflictException(
      'Cannot hard-delete a site that has memberships.',
    );
  }
  if (site._count.bays > 0) {
    throw new ConflictException('Cannot hard-delete a site that has bays.');
  }
  const hasOnlySystemTransit =
    site.storageLocations.length === 1 &&
    site.storageLocations[0].is_system &&
    site.storageLocations[0].type === SYSTEM_LOCATION_TYPE;
  if (!hasOnlySystemTransit) {
    throw new ConflictException(
      'Cannot hard-delete a site that has storage locations other than its empty system in_transit location.',
    );
  }

  if (parkedVehiclesCount > 0) {
    throw new ConflictException(
      'Cannot hard-delete a site that has parked dealer vehicles on a lot at this site.',
    );
  }

  return hasOnlySystemTransit;
}

export function validateSiteMembershipCreateInput(
  member: { id: string; is_active: boolean } | null,
  existingMembership: { id: string } | null,
): void {
  if (!member) {
    throw new BadRequestException(
      'No TenantMember exists for that user in this tenant.',
    );
  }
  if (!member.is_active) {
    throw new UnprocessableEntityException(
      'Cannot grant a site membership to an inactive TenantMember.',
    );
  }

  if (existingMembership) {
    throw new ConflictException(
      'That user already has a membership in this site.',
    );
  }
}
