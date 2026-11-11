import { useEffect, useMemo, type MutableRefObject } from 'react'
import type { TFunction } from 'i18next'

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
  /** Prefer `isPending` when wired: first-load ends once the query has settled, even if `isFetching` continues. */
  isPending?: boolean
  isFetching?: boolean
  isPlaceholderData: boolean
  isError: boolean
  hasUsableData: boolean
  /** ADR-0035: capped count or loaded page is already shown — do not keep a first-load skeleton. */
  listSnapshotResolved?: boolean
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

export function resolveDataTableFetchErrorMessage(
  t: TFunction<'common'>,
  fetchErrorMessage: string | undefined,
  presentation: Pick<DataTablePresentationState, 'staleFetchFailed'>,
  isError: boolean,
  hasUsableData: boolean,
): string | undefined {
  if (fetchErrorMessage) return fetchErrorMessage
  if (presentation.staleFetchFailed || (isError && !hasUsableData)) {
    return t('dataTable.loading.loadFailed')
  }
  return undefined
}

/** ADR-0035: capped count may land before page one; that ends the first-load skeleton gate. */
export function isInfiniteListSnapshotResolved(
  hasUsableData: boolean,
  resolvedTotalCount: { count: number; isCapped: boolean } | undefined,
): boolean {
  return hasUsableData || resolvedTotalCount !== undefined
}

/** Offset lists: API meta (page count / pager) can settle before row cells are painted. */
export function isOffsetListSnapshotResolved(hasUsableData: boolean, offsetMetaResolved: boolean): boolean {
  return hasUsableData || offsetMetaResolved
}

export function isListSnapshotResolved(
  hasUsableData: boolean,
  resolvedTotalCount: { count: number; isCapped: boolean } | undefined,
  offsetMetaResolved: boolean,
): boolean {
  return isInfiniteListSnapshotResolved(hasUsableData, resolvedTotalCount) || offsetMetaResolved
}

export function resolveDataTableListSnapshot(
  hasUsableData: boolean,
  resolvedTotalCount: { count: number; isCapped: boolean } | undefined,
  offsetMetaResolved: boolean,
): boolean {
  return isListSnapshotResolved(hasUsableData, resolvedTotalCount, offsetMetaResolved)
}

export function buildDataTablePresentationInput(input: {
  isLoading: boolean
  isPending?: boolean
  isFetching?: boolean
  isPlaceholderData: boolean
  isError: boolean
  hasUsableData: boolean
  resolvedTotalCount: { count: number; isCapped: boolean } | undefined
  listSnapshotResolvedProp?: boolean
  bypassSkeleton: boolean
}): DataTablePresentationInput {
  return {
    isLoading: input.isLoading,
    isPending: input.isPending,
    isFetching: input.isFetching,
    isPlaceholderData: input.isPlaceholderData,
    isError: input.isError,
    hasUsableData: input.hasUsableData,
    listSnapshotResolved: resolveDataTableListSnapshot(
      input.hasUsableData,
      input.resolvedTotalCount,
      input.listSnapshotResolvedProp ?? false,
    ),
    bypassSkeleton: input.bypassSkeleton,
  }
}

export function mergeRefreshingInfinitePresentation(
  base: DataTablePresentationState,
  isRefreshing: boolean,
): DataTablePresentationState {
  if (!isRefreshing) return base
  return { ...base, isStalePreview: true, ariaBusy: true }
}

export function usePresentationLatencyRef(
  presentationLatencyRef: MutableRefObject<number | null> | undefined,
  presentationLatencyMs: number | null,
) {
  useEffect(() => {
    if (!presentationLatencyRef || presentationLatencyMs === null) return
    presentationLatencyRef.current = presentationLatencyMs
  }, [presentationLatencyMs, presentationLatencyRef])
}

export function shouldShowDataTableFetchError(
  resolvedFetchErrorMessage: string | undefined,
  onRetry: (() => void) | undefined,
  presentation: Pick<DataTablePresentationState, 'staleFetchFailed' | 'showFirstLoadSkeleton'>,
  isError: boolean,
) {
  return Boolean(
    resolvedFetchErrorMessage &&
      onRetry &&
      (presentation.staleFetchFailed || (isError && !presentation.showFirstLoadSkeleton)),
  )
}

/** A stale preview keeps the card list (locked and busy), so the phone layout does not flip while it refetches. */
export function shouldUseMobileDataTableList(
  isMobile: boolean,
  showFirstLoadSkeleton: boolean,
  bodyRowCount: number,
) {
  return isMobile && !showFirstLoadSkeleton && bodyRowCount > 0
}

/** TanStack Query v5 `isLoading` is `isPending && isFetching` — do not keep skeleton on paused pending. */
export function isDataTableFirstLoadActive(
  input: Pick<DataTablePresentationInput, 'isLoading' | 'hasUsableData' | 'listSnapshotResolved'> &
    Partial<Pick<DataTablePresentationInput, 'isPending' | 'isFetching'>>,
): boolean {
  const isPending = input.isPending ?? input.isLoading
  // Legacy `isLoading`-only callers omit isFetching; explicit `false` means paused pending (v5).
  const isActivelyFetching = input.isFetching === undefined ? isPending : input.isFetching
  return isPending && isActivelyFetching && !input.hasUsableData && !input.listSnapshotResolved
}

export function useDataTablePresentation(input: DataTablePresentationInput): DataTablePresentationState {
  const firstLoadActive = isDataTableFirstLoadActive(input)
  const showFirstLoadSkeleton = useFirstLoadSkeletonGate(firstLoadActive, input.bypassSkeleton || input.isError)

  const isStalePreview =
    !showFirstLoadSkeleton &&
    input.hasUsableData &&
    input.isPlaceholderData &&
    Boolean(input.isFetching)

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
