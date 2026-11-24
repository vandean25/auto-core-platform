import { useEffect, useMemo, useState } from 'react'
import { functionalUpdate } from '@tanstack/react-table'
import type { ColumnVisibilityState, OnChangeFn } from '@tanstack/react-table'
import type { LegacyColumnDef } from '@tanstack/react-table/legacy'
import type { DataTableUrl } from '@/hooks/use-data-table-url'
import { DATA_TABLE_URL_SYNC_DEBOUNCE_MS } from '@/hooks/useDataTableQuery'
import type { DataTableDensity } from '@/lib/density-tokens'

function getHideableColumnIds<TData extends object>(columns: readonly LegacyColumnDef<TData>[]): string[] {
  return columns.flatMap((column) => {
    if ('columns' in column) return getHideableColumnIds(column.columns ?? [])
    if (column.enableHiding === false) return []
    // Match TanStack's ID resolution for accessor columns, including dotted accessor keys.
    if ('accessorKey' in column) return [column.id ?? String(column.accessorKey).replaceAll('.', '_')]
    if ('accessorFn' in column) {
      const id = column.id ?? column.header
      return typeof id === 'string' ? [id] : []
    }
    return []
  })
}

function resolveColumnVisibility(cols: string | null, columnIds: readonly string[]): ColumnVisibilityState {
  const hidden = new Set(cols?.split(','))
  return Object.fromEntries(columnIds.filter((id) => hidden.has(id)).map((id) => [id, false]))
}

function serializeColumns(visibility: ColumnVisibilityState, columnIds: readonly string[]): string | null {
  return columnIds.filter((id) => visibility[id] === false).join(',') || null
}

function readDensity(density: string | null): DataTableDensity {
  return density === 'compact' ? density : 'comfortable'
}

function withLayout(params: URLSearchParams, layout: { cols: string | null; density: DataTableDensity }): URLSearchParams {
  const next = new URLSearchParams(params)
  if (layout.cols === null) next.delete('cols')
  else next.set('cols', layout.cols)
  if (layout.density === 'comfortable') next.delete('density')
  else next.set('density', layout.density)
  return next
}

export function useDataTableLayout<TData extends object>(columns: LegacyColumnDef<TData>[], url?: DataTableUrl) {
  const columnIds = useMemo(() => getHideableColumnIds(columns), [columns])
  const urlColumns = url?.searchParams.get('cols') ?? null
  const urlDensity = url?.searchParams.get('density') ?? null
  const source = JSON.stringify([url?.location.pathname, urlColumns, urlDensity])
  const [draft, setDraft] = useState(() => ({ source, cols: urlColumns, density: readDensity(urlDensity) }))
  const layout = draft.source === source ? draft : { source, cols: urlColumns, density: readDensity(urlDensity) }
  if (draft.source !== source) setDraft(layout)

  const columnVisibility = useMemo(() => resolveColumnVisibility(layout.cols, columnIds), [layout.cols, columnIds])
  const cols = serializeColumns(columnVisibility, columnIds)
  const { density } = layout
  const updateSearch = url?.updateSearch

  useEffect(() => {
    if (!updateSearch) return
    const timeout = setTimeout(() => updateSearch((current) => {
      const previousColumns = resolveColumnVisibility(current.get('cols'), columnIds)
      return {
        next: withLayout(current, { cols, density }),
        replace: serializeColumns(previousColumns, columnIds) === cols && readDensity(current.get('density')) === density,
      }
    }), DATA_TABLE_URL_SYNC_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [columnIds, cols, density, source, updateSearch])

  const setColumnVisibility: OnChangeFn<ColumnVisibilityState> = (update) => setDraft((previous) => ({
    ...previous,
    cols: serializeColumns(functionalUpdate(update, resolveColumnVisibility(previous.cols, columnIds)), columnIds),
  }))
  const setDensity = (nextDensity: DataTableDensity) => setDraft((previous) => ({ ...previous, density: nextDensity }))
  const getLayoutHref = url && (() => {
    const query = withLayout(url.searchParams, { cols, density }).toString()
    return query ? `${url.location.pathname}?${query}` : url.location.pathname
  })

  return { columnVisibility, setColumnVisibility, density, setDensity, getLayoutHref }
}
