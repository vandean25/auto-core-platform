import { useMemo } from 'react'

import { useDelayedFlag } from '@/hooks/useDelayedFlag'
import { useFirstLoadSkeletonGate } from '@/hooks/useFirstLoadSkeletonGate'
import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'

export type DataTablePendingRowMeta = {
  __dataTablePending: true
}

export function isDataTablePendingRow(row: object): row is object & DataTablePendingRowMeta {
  return (row as DataTablePendingRowMeta).__dataTablePending === true
}

export type DataTablePresentationInput = {
  isLoading: boolean
  isFetching: boolean
  isPlaceholderData: boolean
  isError: boolean
  hasUsableData: boolean
  /** When true, skeleton minimum and delay are skipped immediately (context reset). */
  bypassSkeleton?: boolean
}

export type DataTablePresentationState = {
  showFirstLoadSkeleton: boolean
  isStalePreview: boolean
  showRefreshIndicator: boolean
  ariaBusy: boolean
  staleFetchFailed: boolean
  /** Milliseconds the first-load skeleton added after data was ready (pilot telemetry). */
  presentationLatencyMs: number | null
}

export function useDataTablePresentation(input: DataTablePresentationInput): DataTablePresentationState {
  const firstLoadActive = input.isLoading && !input.hasUsableData
  const showFirstLoadSkeleton = useFirstLoadSkeletonGate(firstLoadActive, input.bypassSkeleton || input.isError)

  const isStalePreview =
    !showFirstLoadSkeleton &&
    input.hasUsableData &&
    input.isPlaceholderData &&
    input.isFetching

  const staleFetchFailed =
    input.hasUsableData && input.isPlaceholderData && input.isError && !input.isFetching

  const showRefreshIndicator = useDelayedFlag(
    isStalePreview,
    INTERACTION_LOADING_TIMINGS.refreshIndicatorDelayMs,
  )

  const presentationLatencyMs = useMemo(() => {
    if (showFirstLoadSkeleton || !input.hasUsableData || firstLoadActive) return null
    if (!input.isLoading && input.hasUsableData) {
      // Data became usable while the skeleton gate was still holding visibility.
      return INTERACTION_LOADING_TIMINGS.skeletonDelayMs + INTERACTION_LOADING_TIMINGS.skeletonMinVisibleMs
    }
    return null
  }, [firstLoadActive, input.hasUsableData, input.isLoading, showFirstLoadSkeleton])

  const ariaBusy = showFirstLoadSkeleton || (isStalePreview && !staleFetchFailed)

  return {
    showFirstLoadSkeleton,
    isStalePreview,
    showRefreshIndicator,
    ariaBusy,
    staleFetchFailed,
    presentationLatencyMs,
  }
}
