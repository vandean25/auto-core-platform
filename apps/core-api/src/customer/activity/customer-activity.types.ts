import type { EffectiveAccess } from '../../permissions/permission-resolver.js';

export const CUSTOMER_ACTIVITY_TYPES = [
  'workshop_order',
  'sales_order',
  'invoice',
  'credit_note',
  'email',
  'consent',
  'vehicle_notice',
  'loaner_booking',
  'customer_note',
  'audit',
] as const;

export type CustomerActivityType = (typeof CUSTOMER_ACTIVITY_TYPES)[number];

/** Reserved for AUT-629 (`LegacyDocument` -> `'legacy_document'`) once the incadea import source adapter lands. */

export type CustomerActivityCursor = {
  occurredAt: Date;
  type: CustomerActivityType;
  id: string;
};

export type CustomerActivityItem = {
  id: string;
  type: CustomerActivityType;
  occurred_at: string;
  title: string;
  ref_id: string;
  ref_link: string | null;
  summary: Record<string, unknown>;
};

export type CustomerActivityFetchContext = {
  tenantId: string;
  customerId: string;
  customerEmail: string | null;
  authorizedSiteIds: readonly string[];
  getVehicleIds: () => Promise<readonly string[]>;
};

export interface CustomerActivitySourceAdapter {
  readonly type: CustomerActivityType;
  isPermitted(access: EffectiveAccess): boolean;
  fetchItems(
    context: CustomerActivityFetchContext,
    cursor: CustomerActivityCursor | null,
    take: number,
  ): Promise<CustomerActivityItem[]>;
}
