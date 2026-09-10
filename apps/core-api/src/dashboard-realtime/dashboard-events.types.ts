export const DASHBOARD_ENTITY_UPDATED_EVENT = 'entity_updated';
export const AUTH_CLAIMS_UPDATED_EVENT = 'auth:claims_updated';
export const SITE_CONTEXT_UPDATED_EVENT = 'site:context_updated';
export const SITE_ACCESS_SCOPE_UPDATED_EVENT = 'site:access_scope_updated';

export type DashboardEntityType =
  | 'PURCHASE_ORDER'
  | 'PURCHASE_INVOICE'
  | 'WORKSHOP_ORDER'
  | 'WORKSHOP_TASK'
  | 'WORKSHOP_TASK_LINE_ITEM'
  | 'WORKSHOP_MEDIA'
  | 'LABOR_ENTRY'
  | 'SALES_ORDER'
  | 'CATALOG_ITEM'
  | 'CUSTOMER'
  | 'VENDOR'
  | 'VEHICLE'
  | 'VEHICLE_PURCHASE'
  | 'VEHICLE_SALE'
  | 'ATTENDANCE_EVENT'
  | 'LEAVE_REQUEST'
  | 'EMPLOYEE_WORK_SCHEDULE';

export type DashboardEntityAction = 'CREATED' | 'UPDATED' | 'DELETED';

export interface DashboardEntityUpdatedPayload {
  type: DashboardEntityType;
  action: DashboardEntityAction;
  entityId?: string;
  /** Present when the event was emitted to a site room (ADR-0022). */
  siteId?: string;
  timestamp: string;
}

export interface AuthClaimsUpdatedPayload {
  reason: 'membership-updated';
  timestamp: string;
}

export interface SiteContextUpdatedPayload {
  siteId: string | null;
  timestamp: string;
}

export interface SiteAccessScopeUpdatedPayload {
  timestamp: string;
}

export type EmitDashboardEntityUpdatedInput = Omit<
  DashboardEntityUpdatedPayload,
  'timestamp'
>;
