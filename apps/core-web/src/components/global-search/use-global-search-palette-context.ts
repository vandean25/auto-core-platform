import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

import { useAuthSession } from '@/api/auth-session'
import { getFocusedDataTableRowId } from '@/features/shortcuts/shortcut-guard'
import { buildPaletteContextSection } from './build-palette-context-section'
import { intakePrefillForRecord } from './global-search-context-actions'
import { parseGlobalSearchRecordRef } from './global-search-record-route'
import { parseSearchInput } from './global-search-types'
import { useGlobalSearchRecordData } from './use-global-search-record-data'
import { usePaletteContextRunContexts } from './use-palette-context-run-contexts'
import { usePaletteContextTranslations } from './use-palette-context-translations'

export function useGlobalSearchPaletteContext(open: boolean, query: string) {
  const translations = usePaletteContextTranslations()
  const role = useAuthSession().data?.activeRole
  const location = useLocation()
  const runContexts = usePaletteContextRunContexts()

  // Read as the palette opens, before the dialog takes the focus: the list row that had it is the record.
  const focusedListRowId = useMemo(() => (open ? getFocusedDataTableRowId() : null), [open])
  const recordRef = useMemo(
    () => parseGlobalSearchRecordRef(location.pathname, focusedListRowId),
    [focusedListRowId, location.pathname],
  )
  const entityPrefixFilter = Boolean(parseSearchInput(query).types)
  const enabled = open && Boolean(recordRef) && !entityPrefixFilter
  const recordData = useGlobalSearchRecordData(
    role === 'TECH' && recordRef?.entity === 'workshop_order' ? null : recordRef,
    enabled,
  )

  const contextSection = useMemo(() => {
    if (!enabled || !recordRef) return null
    return buildPaletteContextSection(
      recordRef,
      role,
      query,
      recordData,
      translations,
      runContexts,
    )
  }, [enabled, query, recordData, recordRef, role, runContexts, translations])

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
