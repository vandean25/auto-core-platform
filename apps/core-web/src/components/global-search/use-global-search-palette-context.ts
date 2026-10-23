import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'

import { useAuthRole } from '@/features/actions/use-auth-role'
import { buildPaletteContextSection } from './build-palette-context-section'
import { intakePrefillForRecord } from './global-search-context-actions'
import { parseGlobalSearchRecordRef } from './global-search-record-route'
import { parseSearchInput } from './global-search-types'
import { useGlobalSearchRecordData } from './use-global-search-record-data'
import { usePaletteContextRunContexts } from './use-palette-context-run-contexts'

export function useGlobalSearchPaletteContext(open: boolean, query: string) {
  const { t: tNav } = useTranslation('nav')
  const { t: tWorkshop } = useTranslation('workshop')
  const { t: tCustomers } = useTranslation('customers')
  const { t: tVehicles } = useTranslation('vehicles')
  const role = useAuthRole()
  const location = useLocation()
  const runContexts = usePaletteContextRunContexts()

  const recordRef = useMemo(
    () => parseGlobalSearchRecordRef(location.pathname),
    [location.pathname],
  )
  const entityPrefixFilter = Boolean(parseSearchInput(query).types)
  const enabled = open && Boolean(recordRef) && !entityPrefixFilter
  const recordData = useGlobalSearchRecordData(recordRef, enabled)

  const contextSection = useMemo(() => {
    if (!enabled || !recordRef) return null
    return buildPaletteContextSection(
      recordRef,
      role,
      query,
      recordData,
      { nav: tNav, workshop: tWorkshop, customers: tCustomers, vehicles: tVehicles },
      runContexts,
    )
  }, [
    enabled,
    query,
    recordData,
    recordRef,
    role,
    runContexts,
    tCustomers,
    tNav,
    tVehicles,
    tWorkshop,
  ])

  const intakePrefill = useMemo(() => {
    if (!recordRef || entityPrefixFilter) return null
    return intakePrefillForRecord(recordRef, recordData.order, recordData.vehicle)
  }, [entityPrefixFilter, recordData.order, recordData.vehicle, recordRef])

  return {
    contextSection,
    intakePrefill,
    isLoadingContext: recordData.isLoadingContext,
  }
}
