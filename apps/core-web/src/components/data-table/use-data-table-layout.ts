import { useEffect, useMemo, useState } from 'react'
import { functionalUpdate } from '@tanstack/react-table'
import type { ColumnVisibilityState, OnChangeFn } from '@tanstack/react-table'
import type { LegacyColumnDef } from '@tanstack/react-table/legacy'
import type { DataTableUrl } from '@/hooks/use-data-table-url'
import { DATA_TABLE_URL_SYNC_DEBOUNCE_MS } from '@/hooks/useDataTableQuery'
import type { DataTableDensity } from '@/lib/density-tokens'
import { getDataTableColumnMeta } from './data-table-column-meta'

type HideableColumn = { id: string; defaultHidden: boolean }

function getHideableColumns<TData extends object>(columns: readonly LegacyColumnDef<TData>[]): HideableColumn[] {
  return columns.flatMap((column) => {
    if ('columns' in column) return getHideableColumns(column.columns ?? [])
    if (column.enableHiding === false) return []
    // Match TanStack's ID resolution for accessor columns, including dotted accessor keys.
    const id = 'accessorKey' in column
      ? column.id ?? String(column.accessorKey).replaceAll('.', '_')
      : 'accessorFn' in column ? column.id ?? column.header : undefined
    return typeof id === 'string' ? [{ id, defaultHidden: getDataTableColumnMeta(column).defaultHidden === true }] : []
  })
}

function resolveColumnVisibility(cols: string | null, columns: readonly HideableColumn[]): ColumnVisibilityState {
  const toggled = new Set(cols?.split(','))
  return Object.fromEntries(columns.map(({ id, defaultHidden }) => [id, toggled.has(id) === defaultHidden]))
}

function serializeColumns(visibility: ColumnVisibilityState, columns: readonly HideableColumn[]): string | null {
  // A layout stores deviations from defaults, including explicit opt-ins to custom columns.
  return columns.filter(({ id, defaultHidden }) => typeof visibility[id] === 'boolean' && visibility[id] === defaultHidden)
    .map(({ id }) => id).join(',') || null
}

function normalizeColumns(raw: string | null, columns: readonly HideableColumn[]): string | null {
  const active = serializeColumns(resolveColumnVisibility(raw, columns), columns)
  // Custom field IDs can be absent while their definitions are loading.
  const pending = raw?.split(',').filter((id) =>
    id.startsWith('cf.') && !columns.some((column) => column.id === id),
  ) ?? []
  return [active, ...pending].filter(Boolean).join(',') || null
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
  const hideableColumns = useMemo(() => getHideableColumns(columns), [columns])
  const urlColumns = url?.searchParams.get('cols') ?? null
  const urlDensity = url?.searchParams.get('density') ?? null
  const source = JSON.stringify([url?.location.pathname, urlColumns, urlDensity])
  const [draft, setDraft] = useState(() => ({ source, cols: urlColumns, density: readDensity(urlDensity) }))
  const layout = draft.source === source ? draft : { source, cols: urlColumns, density: readDensity(urlDensity) }
  if (draft.source !== source) setDraft(layout)

  const columnVisibility = useMemo(() => resolveColumnVisibility(layout.cols, hideableColumns), [layout.cols, hideableColumns])
  const cols = normalizeColumns(layout.cols, hideableColumns)
  const { density } = layout
  const updateSearch = url?.updateSearch

  useEffect(() => {
    if (!updateSearch) return
    const timeout = setTimeout(() => updateSearch((current) => {
      return {
        next: withLayout(current, { cols, density }),
        replace: normalizeColumns(current.get('cols'), hideableColumns) === cols && readDensity(current.get('density')) === density,
      }
    }), DATA_TABLE_URL_SYNC_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [cols, density, hideableColumns, source, updateSearch])

  const setColumnVisibility: OnChangeFn<ColumnVisibilityState> = (update) => setDraft((previous) => ({
    ...previous,
    cols: serializeColumns(functionalUpdate(update, resolveColumnVisibility(previous.cols, hideableColumns)), hideableColumns),
  }))
  const setDensity = (nextDensity: DataTableDensity) => setDraft((previous) => ({ ...previous, density: nextDensity }))
  const getLayoutHref = url && (() => {
    const query = withLayout(url.searchParams, { cols, density }).toString()
    return query ? `${url.location.pathname}?${query}` : url.location.pathname
  })

  return { columnVisibility, setColumnVisibility, density, setDensity, getLayoutHref }
}
