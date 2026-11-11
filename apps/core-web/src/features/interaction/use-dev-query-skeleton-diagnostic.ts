import { useEffect, useRef } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { isDataTableFirstLoadActive } from '@/components/data-table/data-table-loading'

type DiagnosticInput = {
  screen: string
  queryKey?: readonly unknown[]
  query: Pick<
    UseQueryResult<unknown>,
    'status' | 'fetchStatus' | 'isPending' | 'isFetching' | 'isLoading' | 'dataUpdatedAt' | 'data'
  >
  hasUsableData: boolean
  listSnapshotResolved?: boolean
}

type Aut971QueryTrace = {
  queryKey?: readonly unknown[]
  status: DiagnosticInput['query']['status']
  fetchStatus: DiagnosticInput['query']['fetchStatus']
  isPending: boolean
  isFetching: boolean
  isLoading: boolean
  dataUpdatedAt: number
  dataDefined: boolean
  hasUsableData: boolean
  listSnapshotResolved: boolean | undefined
  gateActive: boolean
}

function buildAut971QueryTrace(fields: Aut971QueryTrace): Aut971QueryTrace {
  return fields
}

/** Dev-only: logs TanStack fields when first-load stays active after payload or >400ms on the gate (AUT-971 pilot). */
export function useDevQuerySkeletonDiagnostic({
  screen,
  queryKey,
  query,
  hasUsableData,
  listSnapshotResolved,
}: DiagnosticInput) {
  const { status, fetchStatus, isPending, isFetching, isLoading, dataUpdatedAt, data } = query
  const payloadMismatchLoggedRef = useRef(false)
  const hangLoggedRef = useRef(false)

  const gateActive = isDataTableFirstLoadActive({
    isLoading,
    isPending,
    isFetching,
    hasUsableData,
    listSnapshotResolved,
  })

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const trace = buildAut971QueryTrace({
      queryKey,
      status,
      fetchStatus,
      isPending,
      isFetching,
      isLoading,
      dataUpdatedAt,
      dataDefined: data !== undefined,
      hasUsableData,
      listSnapshotResolved,
      gateActive,
    })

    if (!gateActive) {
      hangLoggedRef.current = false
    }

    const hangTimer =
      gateActive && !hangLoggedRef.current
        ? window.setTimeout(() => {
            hangLoggedRef.current = true
            console.info(`[AUT-971 skeleton hang] ${screen}`, trace)
          }, 400)
        : undefined

    if (!payloadMismatchLoggedRef.current && data !== undefined) {
      const rowsStuck = !hasUsableData
      if (gateActive || rowsStuck) {
        payloadMismatchLoggedRef.current = true
        console.info(`[AUT-971 skeleton diagnostic] ${screen}`, trace)
      }
    }

    return () => {
      if (hangTimer !== undefined) window.clearTimeout(hangTimer)
    }
  }, [
    data,
    dataUpdatedAt,
    fetchStatus,
    gateActive,
    hasUsableData,
    isFetching,
    isLoading,
    isPending,
    listSnapshotResolved,
    queryKey,
    screen,
    status,
  ])

  useEffect(() => {
    payloadMismatchLoggedRef.current = false
  }, [queryKey])
}
