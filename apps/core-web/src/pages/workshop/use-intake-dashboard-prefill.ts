import { useEffect, useRef } from 'react'

import { useCustomer } from '@/api/customers'
import { useVehicle } from '@/api/vehicles'
import { readWorkshopIntakePrefillFromSearch } from '@/components/global-search/workshop-intake-prefill'
import type { CustomerDetailResponse } from '@/pages/customers/customer-detail-model'
import { applyIntakeDashboardPrefill } from './apply-intake-dashboard-prefill'

export type IntakeSelectedVehicle = {
  id: string
  description: string
  customerId: string
}

type UseIntakeDashboardPrefillArgs = {
  search: string
  selectedVehicle: IntakeSelectedVehicle | null
  setSearch: (value: string) => void
  setSelectedVehicle: (value: IntakeSelectedVehicle | null) => void
}

export function useIntakeDashboardPrefill({
  search,
  selectedVehicle,
  setSearch,
  setSelectedVehicle,
}: UseIntakeDashboardPrefillArgs) {
  const appliedRef = useRef<string | null>(null)
  const prefill = readWorkshopIntakePrefillFromSearch(window.location.search)
  const vehicleQuery = useVehicle(prefill.vehicleId ?? '')
  const customerIdForQuery = prefill.vehicleId ? '' : (prefill.customerId ?? '')
  const customerQuery = useCustomer<CustomerDetailResponse>(customerIdForQuery)

  useEffect(() => {
    const key = `${prefill.vehicleId ?? ''}:${prefill.customerId ?? ''}`
    if (!prefill.vehicleId && !prefill.customerId) {
      appliedRef.current = null
      return
    }
    if (appliedRef.current === key) return

    const result = applyIntakeDashboardPrefill({
      prefill,
      vehicle: vehicleQuery.data,
      customer: customerQuery.data,
      search,
      selectedVehicle,
      setSearch,
      setSelectedVehicle,
    })
    if (result === 'applied' || result === 'skipped') {
      appliedRef.current = key
    }
  }, [
    customerQuery.data,
    prefill,
    search,
    selectedVehicle,
    setSearch,
    setSelectedVehicle,
    vehicleQuery.data,
  ])
}
