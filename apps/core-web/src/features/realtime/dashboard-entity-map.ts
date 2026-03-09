import type { EntityUpdatedPayload, RealtimeEntityType } from '@/features/realtime/types'

const entityToDashboardSourceKeys: Record<RealtimeEntityType, string[]> = {
  PURCHASE_ORDER: ['purchase-orders'],
  PURCHASE_INVOICE: ['purchase-bills'],
  WORKSHOP_ORDER: ['workshop-orders'],
  SALES_ORDER: ['sales-orders'],
  CATALOG_ITEM: ['inventory'],
  CUSTOMER: ['customers'],
  VENDOR: ['vendors'],
  VEHICLE: ['vehicles'],
}

export function getDashboardSourceKeysForEntityType(type: RealtimeEntityType): string[] {
  return entityToDashboardSourceKeys[type] ?? []
}

export function isEntityUpdatedPayload(value: unknown): value is EntityUpdatedPayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<EntityUpdatedPayload>
  if (typeof candidate.type !== 'string') return false
  if (!Object.hasOwn(entityToDashboardSourceKeys, candidate.type)) return false

  return candidate.action === 'CREATED' || candidate.action === 'UPDATED' || candidate.action === 'DELETED'
}
