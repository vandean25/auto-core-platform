import { LocationType } from '@prisma/client';

export const OPEN_STOCK_TRANSFER_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'SHIPPED',
] as const;

export const STOCK_TRANSFER_TERMINAL_STATUSES = [
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;

export const TRANSFER_ENABLED_LOCATION_TYPES: ReadonlySet<LocationType> =
  new Set([LocationType.bin, LocationType.in_transit]);

export const TENANT_ADMIN_ROLES = ['OWNER', 'ADMIN'] as const;
