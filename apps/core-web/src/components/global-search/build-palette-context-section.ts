import type { TFunction } from 'i18next'
import type { Customer } from '@/api/types'
import type { Vehicle } from '@/api/types'
import type { WorkshopOrder } from '@/api/types'
import type { CustomerRowActionContext } from '@/features/actions/customer-row-actions'
import { createCustomerRowActions } from '@/features/actions/customer-row-actions'
import type { VehicleRowActionContext } from '@/features/actions/vehicle-row-actions'
import { createVehicleRowActions } from '@/features/actions/vehicle-row-actions'
import type { WorkshopOrderRowActionContext } from '@/features/actions/work-order-row-actions'
import { createWorkshopOrderRowActions } from '@/features/actions/work-order-row-actions'
import {
  buildCustomerPaletteContextActions,
  buildVehiclePaletteContextActions,
  buildWorkshopOrderPaletteContextActions,
  filterPaletteContextActions,
  type PaletteContextActionSection,
} from './global-search-context-actions'
import type { GlobalSearchRecordRef } from './global-search-record-route'

type PaletteContextTranslations = {
  nav: TFunction<'nav'>
  workshop: TFunction<'workshop'>
  customers: TFunction<'customers'>
  vehicles: TFunction<'vehicles'>
}

type PaletteContextRunContexts = {
  workshop: WorkshopOrderRowActionContext
  customer: CustomerRowActionContext
  vehicle: VehicleRowActionContext
}

export function buildPaletteContextSection(
  ref: GlobalSearchRecordRef,
  role: string | undefined,
  query: string,
  records: {
    order?: WorkshopOrder
    customer?: Customer
    vehicle?: Vehicle
  },
  translations: PaletteContextTranslations,
  runContexts: PaletteContextRunContexts,
): PaletteContextActionSection | null {
  const { nav, workshop, customers, vehicles } = translations
  let items: PaletteContextActionSection['items'] = []

  if (ref.entity === 'workshop_order' && records.order) {
    const definitions = createWorkshopOrderRowActions(workshop)
    items = buildWorkshopOrderPaletteContextActions(
      definitions,
      role,
      records.order,
      runContexts.workshop,
      nav,
    )
  } else if (ref.entity === 'customer' && records.customer) {
    const definitions = createCustomerRowActions(customers)
    items = buildCustomerPaletteContextActions(
      definitions,
      role,
      records.customer,
      runContexts.customer,
      nav,
    )
  } else if (ref.entity === 'vehicle' && records.vehicle) {
    const definitions = createVehicleRowActions(vehicles)
    items = buildVehiclePaletteContextActions(
      definitions,
      role,
      records.vehicle,
      runContexts.vehicle,
      nav,
    )
  }

  const filtered = filterPaletteContextActions(items, query)
  if (filtered.length === 0) return null

  return { heading: nav('globalSearch.contextActions.heading'), items: filtered }
}
