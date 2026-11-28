import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'

import { cellToText, serializeCsv } from '@/lib/csv'
import { INFINITE_LIST_ROW_CAP } from '@/lib/infinite-list-query'
import { getDataTableColumnLabel } from './data-table-column-label'
import type { DataTableInfiniteView } from './use-data-table-infinite'

// Text-like form fields show their value as a property rather than as text, and that value is what a reader sees.
const TEXT_INPUT_TYPES = new Set(['date', 'datetime-local', 'email', 'month', 'number', 'search', 'tel', 'text', 'time', 'url', 'week'])

/** Text of a node as a reader sees it: adjacent elements are separated by a space, so badges stay apart. */
function readDisplayedText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(node.type) ? node.value : ''
  if (node instanceof HTMLTextAreaElement) return node.value
  if (node instanceof HTMLSelectElement) return Array.from(node.selectedOptions, (option) => option.textContent ?? '').join(' ')
  // Icons carry no text.
  if (!(node instanceof Element) || node.matches('svg')) return ''
  if (node.tagName === 'BR') return ' '

  let text = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && text && !text.endsWith(' ')) text += ' '
    text += readDisplayedText(child)
  }
  return text
}

/**
 * Serialises rendered table rows as the user reads them: formatted amounts, names and labels,
 * not the raw record values.
 */
export function buildDataTableCsvFromDom<TData extends object>(
  columns: ReturnType<typeof getDataTableExportColumns<TData>>,
  renderedRows: Element[],
  footerNotice?: string,
): string {
  const cellTexts = renderedRows.map((row) => {
    const cells = Array.from(row.children)
    return columns.map((column) => {
      const cell = cells.find((candidate) => candidate.getAttribute('data-column-id') === column.id)
      return cell ? readDisplayedText(cell).replace(/\s+/g, ' ').trim() : ''
    })
  })
  // A column without an accessor is data only if it shows text, which leaves out icon and checkbox columns.
  const keep = columns.map((column, index) => typeof column.accessorFn !== 'undefined' || cellTexts.some((texts) => texts[index] !== ''))
  if (!keep.some(Boolean)) return ''
  const header = columns.filter((_, index) => keep[index]).map((column) => getDataTableColumnLabel(column))
  const body = cellTexts.map((texts) => texts.filter((_, index) => keep[index]))
  if (footerNotice) body.push([footerNotice])

  return serializeCsv([header, ...body])
}

/**
 * Serialises the cells currently rendered in `root` (used for synchronous offset-page exports when all rows are in DOM).
 */
export function buildDataTableCsv<TData extends object>(table: Table<TData>, root: Element | null, mobile = false): string {
  const columns = getDataTableExportColumns(table)
  if (mobile && root?.querySelector('[data-table-list]')) {
    const body = table.getRowModel().rows.slice(0, INFINITE_LIST_ROW_CAP).map((row) =>
      columns.map((column) => cellToText(row.getValue(column.id)).replace(/\s+/g, ' ').trim()),
    )
    return serializeCsv([columns.map(getDataTableColumnLabel), ...body])
  }
  const renderedRows = root ? Array.from(root.querySelectorAll('tbody tr[data-table-row]')) : []
  return buildDataTableCsvFromDom(columns, renderedRows)
}

type InfinitePageFetchResult = {
  data?: { pages?: Array<{ data?: unknown[] }> }
  hasNextPage?: boolean
  isError?: boolean
  isFetchNextPageError?: boolean
}

export function isInfiniteCsvCapped(infiniteView: DataTableInfiniteView, rowCount: number, hasMoreOverride?: boolean): boolean {
  if (rowCount < INFINITE_LIST_ROW_CAP) return false
  return Boolean(hasMoreOverride ?? infiniteView.hasNextPage)
}

export async function fetchRemainingInfinitePages(
  infiniteView: DataTableInfiniteView,
  initialCount: number,
  isCancelled: () => boolean,
): Promise<{ status: 'done'; capped: boolean; minRows: number } | { status: 'error' | 'cancelled' }> {
  let hasMore = infiniteView.hasNextPage
  let loadedCount = initialCount

  while (hasMore && loadedCount < INFINITE_LIST_ROW_CAP) {
    const result = (await infiniteView.fetchNextPage()) as InfinitePageFetchResult | undefined
    if (isCancelled()) return { status: 'cancelled' }
    if (!result || result.isError || result.isFetchNextPageError) return { status: 'error' }
    loadedCount = result.data?.pages?.reduce((sum, page) => sum + (page.data?.length ?? 0), 0) ?? loadedCount
    hasMore = Boolean(result.hasNextPage)
  }

  return {
    status: 'done',
    capped: isInfiniteCsvCapped(infiniteView, loadedCount, hasMore),
    minRows: Math.min(loadedCount, INFINITE_LIST_ROW_CAP),
  }
}

/**
 * Visible columns that can hold data. The actions column is left out, and so are structural columns
 * without an accessor that the user cannot hide, such as icon columns.
 */
export function getDataTableExportColumns<TData extends object>(table: Table<TData>) {
  return table
    .getVisibleLeafColumns()
    .filter((column) => typeof column.accessorFn !== 'undefined' || (column.id !== 'actions' && column.getCanHide()))
}

/** An explicit file name wins; otherwise the saved-view title is the base name, e.g. "Invoices" becomes invoices.csv. */
export function getDataTableCsvFileName(csvFileName: string | undefined, title: string | undefined): string {
  if (csvFileName) return csvFileName

  const base = (title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'export'}.csv`
}
