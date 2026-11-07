import { useCallback, useMemo, useState } from 'react'

import type { DataTablePendingRowMeta } from '@/components/data-table/data-table-states'
import { getErrorStatus, getPermissionAwareErrorMessage } from '@/lib/error-utils'
import { generateId } from '@/lib/id'

export type PendingCreateRow<TRow> = TRow & DataTablePendingRowMeta & { pendingFailure?: string }

type Entry<TRow> = {
  row: PendingCreateRow<TRow>
  /** Set once the server confirmed; the row stays until the list holds data fetched after this moment. */
  settled?: { serverId: string; settledAt: number }
}

type Options<TPayload, TRow extends { id: string }> = {
  create: (payload: TPayload) => Promise<{ id: string }>
  /** Presentation-only row: entered descriptive values, no number, price or actions (ADR-0036 R1). */
  buildRow: (localId: string, payload: TPayload) => TRow
  serverRows: TRow[]
  /** `dataUpdatedAt` of the list query. */
  dataUpdatedAt: number
  describeError: (error: unknown) => string
  onCreated?: (created: { id: string }) => void
}

/**
 * Server-confirmed create behind a pending row (ADR-0036 R1, creates). The row is local state: it never enters the
 * query cache, so it cannot reach selection, exports, totals or the cursor chain. On success the list refetches and
 * the server row replaces the placeholder once; on failure the row stays with the entered values and a message until
 * dismissed. There is no Retry: these creates have no deduplication contract, so a retry after a lost response could
 * create the record twice.
 */
export function useListPendingCreate<TPayload, TRow extends { id: string }>({
  create,
  buildRow,
  serverRows,
  dataUpdatedAt,
  describeError,
  onCreated,
}: Options<TPayload, TRow>) {
  const [entries, setEntries] = useState<Entry<TRow>[]>([])

  const patch = useCallback((localId: string, change: (entry: Entry<TRow>) => Entry<TRow>) => {
    setEntries((current) => current.map((entry) => (entry.row.id === localId ? change(entry) : entry)))
  }, [])

  const submit = useCallback(
    (payload: TPayload) => {
      const localId = generateId()
      const row = { ...buildRow(localId, payload), __dataTablePending: true as const }
      setEntries((current) => [{ row }, ...current])
      void create(payload).then(
        (created) => {
          patch(localId, (entry) => ({ ...entry, settled: { serverId: created.id, settledAt: Date.now() } }))
          onCreated?.(created)
        },
        (error: unknown) =>
          patch(localId, (entry) => ({ ...entry, row: { ...entry.row, pendingFailure: describeError(error) } })),
      )
    },
    [buildRow, create, describeError, onCreated, patch],
  )

  const dismiss = useCallback((localId: string) => {
    setEntries((current) => current.filter((entry) => entry.row.id !== localId))
  }, [])

  const rows = useMemo<Array<TRow | PendingCreateRow<TRow>>>(() => {
    const visible = entries.filter(({ settled }) => {
      if (!settled) return true
      if (serverRows.some((row) => row.id === settled.serverId)) return false
      // shortcut: millisecond clock. The create refetch starts before the settle callback runs, so a fetch landing in
      // the same ms is the create refetch; the rare unrelated fetch from that ms drops the row early and the next one fills it.
      return dataUpdatedAt < settled.settledAt
    })
    return [...visible.map(({ row }) => row), ...serverRows]
  }, [dataUpdatedAt, entries, serverRows])

  return { rows, submit, dismiss }
}

/** A lost response (no HTTP status) is "not confirmed"; a 403 gets the permission text; any other refusal the fallback. */
export function describePendingCreateError(error: unknown, text: { unconfirmed: string; failed: string }): string {
  return getErrorStatus(error) === null ? text.unconfirmed : getPermissionAwareErrorMessage(error, text.failed)
}
