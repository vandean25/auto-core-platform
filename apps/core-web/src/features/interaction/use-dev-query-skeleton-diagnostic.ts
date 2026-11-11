import { useEffect, useRef } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { isDataTableFirstLoadActive } from '@/components/data-table/data-table-loading'

type DiagnosticInput = {
  screen: string
  query: Pick<
    UseQueryResult<unknown>,
    'status' | 'fetchStatus' | 'isPending' | 'isFetching' | 'isLoading' | 'dataUpdatedAt' | 'data'
  >
  hasUsableData: boolean
  listSnapshotResolved?: boolean
}

/** Dev-only: logs TanStack fields when the query payload exists but the list still treats first-load as active (AUT-971 pilot). */
export function useDevQuerySkeletonDiagnostic({
  screen,
  query,
  hasUsableData,
  listSnapshotResolved,
}: DiagnosticInput) {
  const loggedRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.DEV || loggedRef.current || query.data === undefined) return

    const gateActive = isDataTableFirstLoadActive({
      isLoading: query.isLoading,
      isPending: query.isPending,
      isFetching: query.isFetching,
      hasUsableData,
      listSnapshotResolved,
    })
    const rowsStuck = !hasUsableData
    if (!gateActive && !rowsStuck) return

    loggedRef.current = true
    console.info(`[AUT-971 skeleton diagnostic] ${screen}`, {
      status: query.status,
      fetchStatus: query.fetchStatus,
      isPending: query.isPending,
      isFetching: query.isFetching,
      isLoading: query.isLoading,
      dataUpdatedAt: query.dataUpdatedAt,
      hasUsableData,
      listSnapshotResolved,
      gateActive,
      rowsStuck,
    })
  }, [
    hasUsableData,
    listSnapshotResolved,
    query.data,
    query.dataUpdatedAt,
    query.fetchStatus,
    query.isFetching,
    query.isLoading,
    query.isPending,
    query.status,
    screen,
  ])
}
