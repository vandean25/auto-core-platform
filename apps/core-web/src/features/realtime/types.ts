export const ENTITY_UPDATED_EVENT = "entity_updated";
export const AUTH_CLAIMS_UPDATED_EVENT = "auth:claims_updated";

export type RealtimeEntityType =
  | "PURCHASE_ORDER"
  | "PURCHASE_INVOICE"
  | "WORKSHOP_ORDER"
  | "WORKSHOP_TASK"
  | "WORKSHOP_TASK_LINE_ITEM"
  | "WORKSHOP_MEDIA"
  | "LABOR_ENTRY"
  | "SALES_ORDER"
  | "CATALOG_ITEM"
  | "CUSTOMER"
  | "VENDOR"
  | "VEHICLE"
  | "VEHICLE_PURCHASE"
  | "VEHICLE_SALE"
  | "ATTENDANCE_EVENT"
  | "LEAVE_REQUEST"
  | "EMPLOYEE_WORK_SCHEDULE";

export type RealtimeEntityAction = "CREATED" | "UPDATED" | "DELETED";

export interface EntityUpdatedPayload {
  type: RealtimeEntityType;
  action: RealtimeEntityAction;
  entityId?: string;
  timestamp: string;
}

export interface ClaimsUpdatedPayload {
  reason: "membership-updated";
  timestamp: string;
}

export function isClaimsUpdatedPayload(
  payload: unknown,
): payload is ClaimsUpdatedPayload {
  if (!payload || typeof payload !== "object") return false;

  const value = payload as Partial<ClaimsUpdatedPayload>;

  return (
    value.reason === "membership-updated" && typeof value.timestamp === "string"
  );
}
