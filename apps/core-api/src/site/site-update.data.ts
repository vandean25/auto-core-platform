import type { Site } from '@prisma/client';
import type { UpdateSiteDto } from './dto/site.dto.js';

export function buildSiteUpdateData(dto: UpdateSiteDto, existing: Site) {
  return {
    name: dto.name?.trim() ?? existing.name,
    address_street:
      dto.addressStreet === undefined
        ? existing.address_street
        : dto.addressStreet,
    address_city:
      dto.addressCity === undefined ? existing.address_city : dto.addressCity,
    address_zip:
      dto.addressZip === undefined ? existing.address_zip : dto.addressZip,
    address_country:
      dto.addressCountry === undefined
        ? existing.address_country
        : dto.addressCountry,
    is_active: dto.isActive ?? existing.is_active,
  };
}
