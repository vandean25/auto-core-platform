export const ENTITY_UPDATED_EVENT = 'entity_updated'

export type RealtimeEntityType =
  | 'PURCHASE_ORDER'
  | 'PURCHASE_INVOICE'
  | 'WORKSHOP_ORDER'
  | 'SALES_ORDER'
  | 'CATALOG_ITEM'
  | 'CUSTOMER'
  | 'VENDOR'
  | 'VEHICLE'

export type RealtimeEntityAction = 'CREATED' | 'UPDATED' | 'DELETED'

export interface EntityUpdatedPayload {
  type: RealtimeEntityType
  action: RealtimeEntityAction
  entityId?: string
  timestamp: string
}
