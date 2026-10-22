import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useVehicle } from '@/api/vehicles'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { createVehicleRowActions } from '@/features/actions/vehicle-row-actions'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { vehicleToListRow } from './VehiclePeekContent'
import { usePeekSearchParam } from './use-peek-search-param'

export function useVehiclePeekSheetData() {
  const { t } = useTranslation('vehicles')
  const navigate = useNavigate()
  const { peekId, isPeekOpen, closePeek } = usePeekSearchParam()
  const { data: vehicle, isLoading } = useVehicle(peekId ?? '')
  const role = useAuthRole()

  const listRow = useMemo(() => (vehicle ? vehicleToListRow(vehicle) : null), [vehicle])
  const actionDefinitions = useMemo(() => createVehicleRowActions(t), [t])
  const runContext = useMemo(() => ({ navigate, t }), [navigate, t])

  const openInFullHref = peekId
    ? APP_ROUTE_PATHS.vehicleDetail.replace(':id', peekId)
    : APP_ROUTE_PATHS.vehicles

  const title = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    : t('peek.titleFallback')

  return {
    t,
    peekId,
    isPeekOpen,
    closePeek,
    vehicle,
    isLoading,
    role,
    listRow,
    actionDefinitions,
    runContext,
    openInFullHref,
    title,
  }
}
