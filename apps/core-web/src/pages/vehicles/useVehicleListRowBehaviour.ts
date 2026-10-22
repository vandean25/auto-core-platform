import { useMemo } from 'react'
import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'

import { useAuthRole } from '@/features/actions/use-auth-role'
import {
  createVehicleRowActions,
  type VehicleListRow,
} from '@/features/actions/vehicle-row-actions'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'

export function useVehicleListRowBehaviour(
  t: TFunction<'vehicles'>,
  navigate: NavigateFunction,
  openPeek: (id: string) => void,
) {
  const role = useAuthRole()
  const vehicleActionDefinitions = useMemo(() => createVehicleRowActions(t), [t])

  const tableRowBehaviour = useMemo(
    () => ({
      getRowHref: (row: VehicleListRow) => `/vehicles/${row.id}`,
      getRowAccessibleName: (row: VehicleListRow) => t('list.rowAria', { vehicle: row.vehicle }),
      onRowClick: (row: VehicleListRow) => openPeek(row.id),
    }),
    [openPeek, t],
  )

  const runContext = useMemo(() => ({ navigate, t }), [navigate, t])

  return useRegistryRowBehaviour({
    role,
    definitions: vehicleActionDefinitions,
    runContext,
    tableBehaviour: tableRowBehaviour,
  })
}
