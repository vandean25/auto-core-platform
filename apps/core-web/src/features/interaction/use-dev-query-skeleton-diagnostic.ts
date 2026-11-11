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

function buildAut971QueryTrace(
  query: DiagnosticInput['query'],
  hasUsableData: boolean,
  listSnapshotResolved: boolean | undefined,
  gateActive: boolean,
) {
  return {
    status: query.status,
    fetchStatus: query.fetchStatus,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isLoading: query.isLoading,
    dataUpdatedAt: query.dataUpdatedAt,
    dataDefined: query.data !== undefined,
    hasUsableData,
    listSnapshotResolved,
    gateActive,
  }
}

/** Dev-only: logs TanStack fields when first-load stays active after payload or >400ms on the gate (AUT-971 pilot). */
export function useDevQuerySkeletonDiagnostic({
  screen,
  query,
  hasUsableData,
  listSnapshotResolved,
}: DiagnosticInput) {
  const payloadMismatchLoggedRef = useRef(false)
  const hangLoggedRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const gateActive = isDataTableFirstLoadActive({
      isLoading: query.isLoading,
      isPending: query.isPending,
      isFetching: query.isFetching,
      hasUsableData,
      listSnapshotResolved,
    })

    if (!gateActive) {
      hangLoggedRef.current = false
    }

    const hangTimer =
      gateActive && !hangLoggedRef.current
        ? window.setTimeout(() => {
            hangLoggedRef.current = true
            console.info(
              `[AUT-971 skeleton hang] ${screen}`,
              buildAut971QueryTrace(query, hasUsableData, listSnapshotResolved, gateActive),
            )
          }, 400)
        : undefined

    if (!payloadMismatchLoggedRef.current && query.data !== undefined) {
      const rowsStuck = !hasUsableData
      if (gateActive || rowsStuck) {
        payloadMismatchLoggedRef.current = true
        console.info(
          `[AUT-971 skeleton diagnostic] ${screen}`,
          buildAut971QueryTrace(query, hasUsableData, listSnapshotResolved, gateActive),
        )
      }
    }

    return () => {
      if (hangTimer !== undefined) window.clearTimeout(hangTimer)
    }
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
