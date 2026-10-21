import { LocationType } from '@prisma/client';

export const TRANSFER_ENABLED_LOCATION_TYPES: ReadonlySet<LocationType> =
  new Set([LocationType.bin, LocationType.in_transit]);

export const TENANT_ADMIN_ROLES = ['OWNER', 'ADMIN'] as const;
