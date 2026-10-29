export const SYSTEM_LOCATION_TYPE = 'in_transit';
export const SYSTEM_LOCATION_CODE = 'TRANSIT';
export const DEALER_STOCK_STATUSES = [
  'IN_STOCK',
  'RESERVED',
  'IN_PREP',
] as const;
export const DEALER_INVENTORY_ROLES = ['USED', 'NEW', 'DEMO'] as const;

export type TenantAdminUser = {
  role?: string;
  userId?: string;
};
