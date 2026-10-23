import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'

import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { canOpenVehicle } from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type VehicleListRow = {
  id: string
  vehicle: string
}

export type VehicleRowActionContext = {
  navigate: NavigateFunction
  t: TFunction<'vehicles'>
}

export function createVehicleRowActions(
  t: TFunction<'vehicles'>,
): EntityActionDefinition<VehicleListRow, VehicleRowActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.vehicleOpen,
      kind: 'navigate',
      label: t('list.actions.open'),
      icon: ExternalLink,
      shortcutKey: 'o',
      isAllowedForRole: canOpenVehicle,
      isEnabled: () => true,
      run: (row, { navigate }) => {
        navigate(APP_ROUTE_PATHS.vehicleDetail.replace(':id', row.id))
      },
    },
  ]
}
