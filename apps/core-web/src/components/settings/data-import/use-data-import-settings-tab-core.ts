import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { useImportEntityTypes, useImportSources, useImportTemplate } from '@/api/imports'
import { usePriceJumpThreshold } from '@/api/margin-rules'
import { useVendors } from '@/api/vendors'
import { isImportEntityTypeUi, wizardImportEntityTypes } from '@/lib/i18n/enum-registry'

import type { ImportEntityTypeUi } from './import-field-labels'
import { useImportWizardState } from './use-import-wizard-state'

function initialEntityFromParam(param: string | null): ImportEntityTypeUi {
  return param !== null && isImportEntityTypeUi(param) ? param : 'CUSTOMER'
}

export function useDataImportSettingsTabCore() {
  const { t } = useTranslation(['settings', 'common'])
  const [searchParams] = useSearchParams()
  const initialEntityType = initialEntityFromParam(searchParams.get('entity'))

  const sourcesQuery = useImportSources()
  const sources = sourcesQuery.data?.data ?? []
  const defaultSource = sources.find((s) => s.is_default) ?? sources[0]

  const [sourceSystem, setSourceSystem] = React.useState(defaultSource?.key ?? '')

  const wizard = useImportWizardState({
    initialEntityType,
    initialVendorId: searchParams.get('vendorId') ?? undefined,
  })
  const { resetDryRun, setStep } = wizard

  // A deleted source must not stay selected: fall back to the default (or no
  // selection) and return to step 1 so the next upload uses a current source.
  React.useEffect(() => {
    if (!sourcesQuery.data) return
    if (sourceSystem && sources.some((s) => s.key === sourceSystem)) return
    const fallbackKey = defaultSource?.key ?? ''
    if (sourceSystem === fallbackKey) return
    setSourceSystem(fallbackKey)
    resetDryRun()
    setStep(1)
  }, [defaultSource, resetDryRun, setStep, sourceSystem, sources, sourcesQuery.data])

  const entityTypesQuery = useImportEntityTypes()
  const entityTypeEntries = entityTypesQuery.data
  const entityTypes = React.useMemo(
    () => wizardImportEntityTypes(entityTypeEntries ?? []),
    [entityTypeEntries],
  )
  const { data: vendorsData } = useVendors({ page: 1, pageSize: 100, filters: [] })
  const { data: template } = useImportTemplate(wizard.entityType)
  const thresholdQuery = usePriceJumpThreshold()
  const configuredThreshold =
    thresholdQuery.data?.price_jump_threshold_percent ??
    thresholdQuery.data?.threshold_percent ??
    20

  return {
    t,
    sourceSystem,
    setSourceSystem,
    sources,
    sourcesFailed: sourcesQuery.isError,
    retrySources: () => void sourcesQuery.refetch(),
    wizard,
    entityTypes,
    entityTypesFailed: entityTypesQuery.isError,
    retryEntityTypes: () => void entityTypesQuery.refetch(),
    vendors: vendorsData?.data ?? [],
    template,
    configuredThreshold,
  }
}
