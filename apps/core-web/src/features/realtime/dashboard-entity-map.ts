import type { QueryKey } from '@tanstack/react-query'
import { customerKeys } from '@/api/customers'
import { hrKeys } from '@/api/hr'
import { inventoryKeys } from '@/api/inventory'
import { mechanicQueueKeys } from '@/api/mechanic'
import { purchaseInvoiceKeys } from '@/api/usePurchaseInvoices'
import { purchaseOrderKeys } from '@/api/purchase-orders'
import { salesOrderKeys } from '@/api/sales-orders'
import { vehicleKeys } from '@/api/vehicles'
import { vehicleStockKeys } from '@/api/vehicle-stock'
import { vendorKeys } from '@/api/vendors'
import { workshopKeys } from '@/api/workshop'
import type { EntityUpdatedPayload, RealtimeEntityType } from '@/features/realtime/types'

type EntityInvalidationTarget = {
  dashboardSourceKeys: readonly string[]
  domainQueryKeys: readonly QueryKey[]
}

const DASHBOARD_WIDGET_DATA_KEY = 'dashboard-widget-data'

const workshopAndMechanicQueueKeys: readonly QueryKey[] = [
  workshopKeys.all,
  mechanicQueueKeys.all,
]

const entityInvalidationMap: Record<RealtimeEntityType, EntityInvalidationTarget> = {
  PURCHASE_ORDER: {
    dashboardSourceKeys: ['purchase-orders'],
    domainQueryKeys: [purchaseOrderKeys.all],
  },
  PURCHASE_INVOICE: {
    dashboardSourceKeys: ['purchase-bills', 'purchase-invoices'],
    domainQueryKeys: [purchaseInvoiceKeys.all],
  },
  WORKSHOP_ORDER: {
    dashboardSourceKeys: ['workshop-orders'],
    domainQueryKeys: workshopAndMechanicQueueKeys,
  },
  WORKSHOP_TASK: {
    dashboardSourceKeys: ['workshop-tasks'],
    domainQueryKeys: workshopAndMechanicQueueKeys,
  },
  WORKSHOP_TASK_LINE_ITEM: {
    dashboardSourceKeys: ['workshop-task-line-items'],
    domainQueryKeys: workshopAndMechanicQueueKeys,
  },
  WORKSHOP_MEDIA: {
    dashboardSourceKeys: ['workshop-media'],
    domainQueryKeys: workshopAndMechanicQueueKeys,
  },
  LABOR_ENTRY: {
    dashboardSourceKeys: ['labor-entries'],
    domainQueryKeys: workshopAndMechanicQueueKeys,
  },
  SALES_ORDER: {
    dashboardSourceKeys: ['sales-orders'],
    domainQueryKeys: [salesOrderKeys.all],
  },
  CATALOG_ITEM: {
    dashboardSourceKeys: ['inventory'],
    domainQueryKeys: [inventoryKeys.all],
  },
  CUSTOMER: {
    dashboardSourceKeys: ['customers'],
    domainQueryKeys: [customerKeys.all],
  },
  VENDOR: {
    dashboardSourceKeys: ['vendors'],
    domainQueryKeys: [vendorKeys.all],
  },
  VEHICLE: {
    dashboardSourceKeys: ['vehicles', 'vehicle-stock'],
    domainQueryKeys: [vehicleKeys.all, vehicleStockKeys.all],
  },
  VEHICLE_PURCHASE: {
    dashboardSourceKeys: ['vehicle-stock'],
    domainQueryKeys: [vehicleStockKeys.all],
  },
  VEHICLE_SALE: {
    dashboardSourceKeys: ['vehicle-stock'],
    domainQueryKeys: [vehicleStockKeys.all],
  },
  ATTENDANCE_EVENT: {
    dashboardSourceKeys: [],
    domainQueryKeys: [hrKeys.all],
  },
  LEAVE_REQUEST: {
    dashboardSourceKeys: [],
    domainQueryKeys: [hrKeys.all, workshopKeys.planner()],
  },
}

const emptyInvalidationTarget: EntityInvalidationTarget = {
  dashboardSourceKeys: [],
  domainQueryKeys: [],
}

function getEntityInvalidationTarget(type: RealtimeEntityType): EntityInvalidationTarget {
  return entityInvalidationMap[type] ?? emptyInvalidationTarget
}

export function getDashboardSourceKeysForEntityType(type: RealtimeEntityType): readonly string[] {
  return getEntityInvalidationTarget(type).dashboardSourceKeys
}

export function getDomainQueryKeysForEntityType(type: RealtimeEntityType): readonly QueryKey[] {
  return getEntityInvalidationTarget(type).domainQueryKeys
}

export function getQueryKeysToInvalidateForEntityType(type: RealtimeEntityType): QueryKey[] {
  const target = getEntityInvalidationTarget(type)
  const dashboardQueryKeys = target.dashboardSourceKeys.map(
    (sourceKey) => [DASHBOARD_WIDGET_DATA_KEY, sourceKey] as const,
  )
  return [...dashboardQueryKeys, ...target.domainQueryKeys]
}

export function isEntityUpdatedPayload(value: unknown): value is EntityUpdatedPayload {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<EntityUpdatedPayload>
  if (typeof candidate.type !== 'string') return false
  if (!Object.hasOwn(entityInvalidationMap, candidate.type)) return false
  if (typeof candidate.timestamp !== 'string') return false

  return candidate.action === 'CREATED' || candidate.action === 'UPDATED' || candidate.action === 'DELETED'
}
