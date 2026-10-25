import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { ImportJob } from '@/api/imports'
import { useApplyImportJob, type ApplyImportJobPayload } from '@/api/imports'
import { laborKeys } from '@/api/labor'
import { getErrorMessage } from '@/lib/error-utils'

import type { ImportEntityTypeUi } from './import-field-labels'
import { canApplyImport } from './import-wizard-logic'

function buildApplyPayload(params: {
  entityType: ImportEntityTypeUi
  jobId: string
  acceptAllPriceJumps: boolean
  acceptedRowNumbers: number[]
}): ApplyImportJobPayload {
  if (params.entityType !== 'SUPPLIER_PRICE_LIST') {
    return params.jobId
  }
  return {
    jobId: params.jobId,
    options: {
      accept_all_price_jumps: params.acceptAllPriceJumps,
      accepted_row_numbers: params.acceptAllPriceJumps
        ? undefined
        : params.acceptedRowNumbers.length > 0
          ? params.acceptedRowNumbers
          : undefined,
    },
  }
}

function canStartApply(params: {
  dryRunJob: ImportJob | null
  applyEnabled: boolean
  inFlight: boolean
}): boolean {
  return Boolean(params.dryRunJob) && params.applyEnabled && !params.inFlight
}

function applyIsEnabled(params: {
  dryRunJob: ImportJob | null
  dryRunStale: boolean
  errorThreshold: number
  isPending: boolean
  applyInFlight: boolean
}): boolean {
  return canApplyImport({
    dryRunJob: params.dryRunJob,
    dryRunStale: params.dryRunStale,
    errorThreshold: params.errorThreshold,
    isApplying: params.isPending || params.applyInFlight,
  })
}

function invalidateLaborCaches(
  queryClient: QueryClient,
  entityType: ImportEntityTypeUi,
): void {
  if (entityType !== 'LABOR_OPERATION') return
  void queryClient.invalidateQueries({ queryKey: laborKeys.operations() })
  void queryClient.invalidateQueries({ queryKey: laborKeys.categories() })
}

/** Applies a dry-run job and keeps the confirm dialog and the labor caches in sync. */
export function useImportApply(params: {
  entityType: ImportEntityTypeUi
  dryRunJob: ImportJob | null
  dryRunStale: boolean
  errorThreshold: number
  acceptAllPriceJumps: boolean
  acceptedRowNumbers: number[]
  onApplied: (job: ImportJob) => void
}): {
  applyEnabled: boolean
  isPending: boolean
  applyInFlight: boolean
  confirmApplyOpen: boolean
  setConfirmApplyOpen: (open: boolean) => void
  handleApply: () => Promise<void>
} {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const mutation = useApplyImportJob()
  const [applyInFlight, setApplyInFlight] = React.useState(false)
  const [confirmApplyOpen, setConfirmApplyOpen] = React.useState(false)
  const applyInFlightRef = React.useRef(false)

  const applyEnabled = applyIsEnabled({
    dryRunJob: params.dryRunJob,
    dryRunStale: params.dryRunStale,
    errorThreshold: params.errorThreshold,
    isPending: mutation.isPending,
    applyInFlight,
  })

  const handleApply = async () => {
    const job = params.dryRunJob
    const startable = canStartApply({
      dryRunJob: job,
      applyEnabled,
      inFlight: applyInFlightRef.current,
    })
    if (!startable || !job) return
    applyInFlightRef.current = true
    setApplyInFlight(true)
    try {
      const result = await mutation.mutateAsync(
        buildApplyPayload({
          entityType: params.entityType,
          jobId: job.id,
          acceptAllPriceJumps: params.acceptAllPriceJumps,
          acceptedRowNumbers: params.acceptedRowNumbers,
        }),
      )
      if (result.status === 'APPLIED') {
        params.onApplied(result)
        setConfirmApplyOpen(false)
        invalidateLaborCaches(queryClient, params.entityType)
        toast.success(t('dataImport.toast.applied'))
        return
      }
      if (result.status === 'APPLYING') {
        params.onApplied(result)
        setConfirmApplyOpen(false)
        return
      }
      params.onApplied(result)
      setConfirmApplyOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.toast.applyFailed')))
    } finally {
      applyInFlightRef.current = false
      setApplyInFlight(false)
    }
  }

  return {
    applyEnabled,
    isPending: mutation.isPending,
    applyInFlight,
    confirmApplyOpen,
    setConfirmApplyOpen,
    handleApply,
  }
}
