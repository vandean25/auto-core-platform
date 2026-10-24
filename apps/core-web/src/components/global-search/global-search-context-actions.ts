import type { LucideIcon } from 'lucide-react'
import type { TFunction } from 'i18next'

import type { Customer } from '@/api/types'
import type { WorkshopOrder } from '@/api/types'
import type { Vehicle } from '@/api/types'
import {
  executeEntityAction,
  filterEntityActions,
  resolveEntityActionChildren,
  type EntityActionChild,
  type EntityActionDefinition,
} from '@/features/actions/entity-action'
import type { CustomerListRow } from '@/features/actions/customer-row-actions'
import type { VehicleListRow } from '@/features/actions/vehicle-row-actions'
import type { WorkshopOrderListRow } from '@/features/actions/work-order-row-actions'
import { vehicleToListRow } from '@/features/peek/VehiclePeekContent'
import { workshopOrderToListRow } from '@/features/peek/WorkshopOrderPeekContent'
import type { GlobalSearchRecordRef } from './global-search-record-route'
import type { WorkshopIntakePrefill } from './workshop-intake-prefill'

export type PaletteContextAction = {
  id: string
  label: string
  icon?: LucideIcon
  description: string
  destructive?: boolean
  children?: PaletteContextAction[]
  onSelect: () => void
}

export type PaletteContextActionSection = {
  heading: string
  items: PaletteContextAction[]
}

export function filterPaletteContextActions(
  actions: PaletteContextAction[],
  query: string,
): PaletteContextAction[] {
  const trimmed = query.trim()
  if (!trimmed) return actions

  const lower = trimmed.toLowerCase()
  return actions.filter(
    (action) =>
      action.label.toLowerCase().includes(lower) ||
      action.description.toLowerCase().includes(lower),
  )
}

function mapRegistryChildren<TRecord extends object, TRunContext>(
  children: EntityActionChild<TRecord, TRunContext>[] | undefined,
  role: string | undefined,
  record: TRecord,
  runContext: TRunContext,
  fallbackDescription: string,
): PaletteContextAction[] | undefined {
  if (!children) return undefined

  return children
    .filter(
      (child) =>
        (child.isAllowedForRole ? child.isAllowedForRole(role) : true) &&
        (child.isEnabled ? child.isEnabled(record) : true),
    )
    .map((child) => {
      const nested = resolveEntityActionChildren(child.children, record, runContext)
      return {
        id: child.id,
        label: child.label,
        icon: child.icon,
        description: child.description ?? fallbackDescription,
        destructive: child.destructive,
        children: mapRegistryChildren(nested, role, record, runContext, fallbackDescription),
        onSelect: () => {
          executeEntityAction(child, record, runContext)
        },
      }
    })
}

export function mapRegistryActionsToPalette<TRecord extends object, TRunContext>(
  definitions: EntityActionDefinition<TRecord, TRunContext>[],
  role: string | undefined,
  record: TRecord,
  runContext: TRunContext,
  describe: (definition: EntityActionDefinition<TRecord, TRunContext>) => string,
): PaletteContextAction[] {
  return filterEntityActions(definitions, role, record).flatMap((definition) => {
    const description = describe(definition)
    const rawChildren = resolveEntityActionChildren(definition.children, record, runContext)
    const children = mapRegistryChildren(rawChildren, role, record, runContext, description)
    if (definition.children && (!children || children.length === 0)) return []

    return [
      {
        id: definition.id,
        label: definition.label,
        icon: definition.icon,
        description,
        destructive: definition.destructive,
        children,
        onSelect: () => {
          executeEntityAction(definition, record, runContext)
        },
      },
    ]
  })
}

export function buildWorkshopOrderPaletteContextActions<TRunContext>(
  definitions: EntityActionDefinition<WorkshopOrderListRow, TRunContext>[],
  role: string | undefined,
  order: WorkshopOrder,
  runContext: TRunContext,
  t: TFunction<'nav'>,
): PaletteContextAction[] {
  const record = workshopOrderToListRow(order)
  return mapRegistryActionsToPalette(definitions, role, record, runContext, () =>
    t('globalSearch.contextActions.workOrder', { orderNo: record.orderNo }),
  )
}

export function buildCustomerPaletteContextActions<TRunContext>(
  definitions: EntityActionDefinition<CustomerListRow, TRunContext>[],
  role: string | undefined,
  customer: Customer,
  runContext: TRunContext,
  t: TFunction<'nav'>,
): PaletteContextAction[] {
  return mapRegistryActionsToPalette(definitions, role, customer, runContext, () =>
    t('globalSearch.contextActions.customer'),
  )
}

export function buildVehiclePaletteContextActions<TRunContext>(
  definitions: EntityActionDefinition<VehicleListRow, TRunContext>[],
  role: string | undefined,
  vehicle: Vehicle,
  runContext: TRunContext,
  t: TFunction<'nav'>,
): PaletteContextAction[] {
  const record = vehicleToListRow(vehicle)
  return mapRegistryActionsToPalette(definitions, role, record, runContext, () =>
    t('globalSearch.contextActions.vehicle', { vehicle: record.vehicle }),
  )
}

export function intakePrefillForRecord(
  ref: GlobalSearchRecordRef,
  order: WorkshopOrder | undefined,
  vehicle: Vehicle | undefined,
): WorkshopIntakePrefill | null {
  if (ref.entity === 'workshop_order' && order) {
    return { customerId: order.customer?.id, vehicleId: order.vehicle?.id }
  }
  if (ref.entity === 'customer') {
    return { customerId: ref.id }
  }
  if (ref.entity === 'vehicle' && vehicle) {
    return { customerId: vehicle.customer?.id, vehicleId: vehicle.id }
  }
  return null
}
