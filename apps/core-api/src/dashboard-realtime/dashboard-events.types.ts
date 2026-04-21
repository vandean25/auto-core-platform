export const DASHBOARD_ENTITY_UPDATED_EVENT = 'entity_updated';

export type DashboardEntityType =
  | 'PURCHASE_ORDER'
  | 'PURCHASE_INVOICE'
  | 'WORKSHOP_ORDER'
  | 'SALES_ORDER'
  | 'CATALOG_ITEM'
  | 'CUSTOMER'
  | 'VENDOR'
  | 'VEHICLE';

export type DashboardEntityAction = 'CREATED' | 'UPDATED' | 'DELETED';

export interface DashboardEntityUpdatedPayload {
  tenantId: string;
  type: DashboardEntityType;
  action: DashboardEntityAction;
  entityId?: string;
  timestamp: string;
}

export type EmitDashboardEntityUpdatedInput = Omit<
  DashboardEntityUpdatedPayload,
  'timestamp' | 'tenantId'
>;
