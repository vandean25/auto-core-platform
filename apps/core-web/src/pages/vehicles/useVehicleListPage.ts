import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import type { components } from '@/api/generated/openapi'
import { useCreateVehicle, useVehicles } from '@/api/vehicles'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { MAX_VEHICLE_LIST_PAGE_SIZE } from '@/lib/list-page-size'
import type { VehicleListRow } from '@/features/actions/vehicle-row-actions'
import { usePeekSearchParam } from '@/features/peek/use-peek-search-param'
import { describePendingCreateError, useListPendingCreate } from '@/features/interaction/use-list-pending-create'
import { useVehicleListRowBehaviour } from './useVehicleListRowBehaviour'
import { useVehicleListColumns, type VehicleListColumnRow } from './useVehicleListColumns'

export type VehicleListPageRow = VehicleListRow & VehicleListColumnRow

function getCustomerLabel(
  t: TFunction<'vehicles'>,
  customer?: {
    type: 'PRIVATE' | 'COMPANY'
    first_name: string
    last_name: string
    company_name?: string
  } | null,
) {
  if (!customer) return t('shared.unassigned')
  if (customer.type === 'COMPANY' && customer.company_name) return customer.company_name
  return `${customer.first_name} ${customer.last_name}`.trim()
}

export function useVehicleListPage() {
  const { t } = useTranslation('vehicles')
  const { t: tCommon } = useTranslation('common')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicles')
  }, [])
  const navigate = useNavigate()
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10, maxPageSize: MAX_VEHICLE_LIST_PAGE_SIZE })
  const vehiclesQuery = useVehicles(queryParams)
  const { data: responseData, dataUpdatedAt } = vehiclesQuery
  const listSettled = vehiclesQuery.data !== undefined

  const rows = useMemo<VehicleListPageRow[]>(() => {
    return (responseData?.data ?? []).map((vehicle) => ({
      id: vehicle.id,
      vehicle: `${vehicle.make} ${vehicle.model}`,
      year: vehicle.year,
      vin: vehicle.vin || t('shared.notAvailable'),
      plate: vehicle.plate || t('shared.notAvailable'),
      customer: getCustomerLabel(t, vehicle.customer),
    }))
  }, [responseData, t])

  const createVehicle = useCreateVehicle()
  const buildPendingRow = useCallback(
    (localId: string, payload: components['schemas']['CreateVehicleDto']): VehicleListPageRow => ({
      id: localId,
      vehicle: `${payload.make} ${payload.model}`,
      year: payload.year,
      vin: payload.vin || t('shared.notAvailable'),
      plate: payload.plate || t('shared.notAvailable'),
      customer: '',
    }),
    [t],
  )
  const pending = useListPendingCreate<components['schemas']['CreateVehicleDto'], VehicleListPageRow>({
    create: createVehicle.mutateAsync,
    buildRow: buildPendingRow,
    serverRows: rows,
    dataUpdatedAt,
    describeError: (error) =>
      describePendingCreateError(error, { unconfirmed: t('dialog.createUnconfirmed'), failed: t('dialog.saveFailed') }),
    onCreated: () => toast.success(t('dialog.created')),
  })

  const peek = usePeekSearchParam()
  const rowBehaviour = useVehicleListRowBehaviour(t, navigate, peek.openPeek, rows)
  const columns = useVehicleListColumns(t, tCommon, pending.dismiss)

  return {
    t,
    vehiclesQuery,
    responseData,
    listSettled,
    tableState,
    pending,
    columns,
    rowBehaviour,
    peek,
  }
}
