export const DASHBOARD_ENTITY_UPDATED_EVENT = 'entity_updated';
export const AUTH_CLAIMS_UPDATED_EVENT = 'auth:claims_updated';

export type DashboardEntityType =
  | 'PURCHASE_ORDER'
  | 'PURCHASE_INVOICE'
  | 'WORKSHOP_ORDER'
  | 'WORKSHOP_TASK'
  | 'SALES_ORDER'
  | 'CATALOG_ITEM'
  | 'CUSTOMER'
  | 'VENDOR'
  | 'VEHICLE';

export type DashboardEntityAction = 'CREATED' | 'UPDATED' | 'DELETED';

export interface DashboardEntityUpdatedPayload {
  type: DashboardEntityType;
  action: DashboardEntityAction;
  entityId?: string;
  timestamp: string;
}

export interface AuthClaimsUpdatedPayload {
  reason: 'membership-updated';
  timestamp: string;
}

export type EmitDashboardEntityUpdatedInput = Omit<
  DashboardEntityUpdatedPayload,
  'timestamp'
>;
