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

type Aut971QueryTrace = {
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

function buildAut971QueryTrace(
  fields: Omit<Aut971QueryTrace, 'hasUsableData' | 'listSnapshotResolved' | 'gateActive'> & {
    hasUsableData: boolean
    listSnapshotResolved: boolean | undefined
    gateActive: boolean
  },
): Aut971QueryTrace {
  return {
    status: fields.status,
    fetchStatus: fields.fetchStatus,
    isPending: fields.isPending,
    isFetching: fields.isFetching,
    isLoading: fields.isLoading,
    dataUpdatedAt: fields.dataUpdatedAt,
    dataDefined: fields.dataDefined,
    hasUsableData: fields.hasUsableData,
    listSnapshotResolved: fields.listSnapshotResolved,
    gateActive: fields.gateActive,
  }
}

/** Dev-only: logs TanStack fields when first-load stays active after payload or >400ms on the gate (AUT-971 pilot). */
export function useDevQuerySkeletonDiagnostic({
  screen,
  query,
  hasUsableData,
  listSnapshotResolved,
}: DiagnosticInput) {
  const { status, fetchStatus, isPending, isFetching, isLoading, dataUpdatedAt, data } = query
  const payloadMismatchLoggedRef = useRef(false)
  const hangLoggedRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const gateActive = isDataTableFirstLoadActive({
      isLoading,
      isPending,
      isFetching,
      hasUsableData,
      listSnapshotResolved,
    })

    const traceFields = {
      status,
      fetchStatus,
      isPending,
      isFetching,
      isLoading,
      dataUpdatedAt,
      dataDefined: data !== undefined,
    }

    if (!gateActive) {
      hangLoggedRef.current = false
    }

    const hangTimer =
      gateActive && !hangLoggedRef.current
        ? window.setTimeout(() => {
            hangLoggedRef.current = true
            console.info(
              `[AUT-971 skeleton hang] ${screen}`,
              buildAut971QueryTrace({ ...traceFields, hasUsableData, listSnapshotResolved, gateActive }),
            )
          }, 400)
        : undefined

    if (!payloadMismatchLoggedRef.current && data !== undefined) {
      const rowsStuck = !hasUsableData
      if (gateActive || rowsStuck) {
        payloadMismatchLoggedRef.current = true
        console.info(
          `[AUT-971 skeleton diagnostic] ${screen}`,
          buildAut971QueryTrace({ ...traceFields, hasUsableData, listSnapshotResolved, gateActive }),
        )
      }
    }

    return () => {
      if (hangTimer !== undefined) window.clearTimeout(hangTimer)
    }
  }, [
    data,
    dataUpdatedAt,
    fetchStatus,
    hasUsableData,
    isFetching,
    isLoading,
    isPending,
    listSnapshotResolved,
    screen,
    status,
  ])
}
