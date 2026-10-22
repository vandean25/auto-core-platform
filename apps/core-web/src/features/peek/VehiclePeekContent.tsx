import type { TFunction } from 'i18next'

import type { Vehicle } from '@/api/types'
import type { VehicleListRow } from '@/features/actions/vehicle-row-actions'

export function vehicleToListRow(vehicle: Vehicle): VehicleListRow {
  return {
    id: vehicle.id,
    vehicle: `${vehicle.make} ${vehicle.model}`,
  }
}

function getCustomerLabel(t: TFunction<'vehicles'>, customer: Vehicle['customer']) {
  if (!customer) return t('shared.unassigned')
  if (customer.type === 'COMPANY' && customer.company_name) return customer.company_name
  return `${customer.first_name} ${customer.last_name}`.trim()
}

export function VehiclePeekContent({
  vehicle,
  t,
}: {
  vehicle: Vehicle
  t: TFunction<'vehicles'>
}) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">{t('list.columns.year')}</dt>
        <dd className="font-medium">{vehicle.year}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('list.columns.plate')}</dt>
        <dd>{vehicle.plate || t('shared.notAvailable')}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">{t('list.columns.vin')}</dt>
        <dd className="text-xs">{vehicle.vin || t('shared.notAvailable')}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">{t('list.columns.customer')}</dt>
        <dd>{getCustomerLabel(t, vehicle.customer)}</dd>
      </div>
    </dl>
  )
}
