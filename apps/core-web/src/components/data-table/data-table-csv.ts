import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'

import { serializeCsv } from '@/lib/csv'
import { getDataTableColumnLabel } from './data-table-column-label'

// Elements whose text is not the value a reader sees: form fields keep their value outside the text,
// native selects list every option, and icons carry no text. Buttons and comboboxes show their value as text.
const NON_TEXT_SELECTOR = 'input, select, textarea, svg'

/** Text of a node as a reader sees it: adjacent elements are separated by a space, so badges stay apart. */
function readDisplayedText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof Element) || node.matches(NON_TEXT_SELECTOR)) return ''
  if (node.tagName === 'BR') return ' '

  let text = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && text && !text.endsWith(' ')) text += ' '
    text += readDisplayedText(child)
  }
  return text
}

/**
 * Serialises the cells the table is rendering right now, as the user reads them: formatted amounts,
 * names and labels, not the raw record values. Server-paged lists therefore export the loaded page.
 */
export function buildDataTableCsv<TData extends object>(table: Table<TData>, root: Element | null): string {
  const columns = getDataTableExportColumns(table)
  const header = columns.map((column) => getDataTableColumnLabel(column))
  const renderedRows = root ? Array.from(root.querySelectorAll('tbody tr[data-table-row]')) : []
  const body = renderedRows.map((row) => {
    const cells = Array.from(row.children)
    return columns.map((column) => {
      const cell = cells.find((candidate) => candidate.getAttribute('data-column-id') === column.id)
      return cell ? readDisplayedText(cell).replace(/\s+/g, ' ').trim() : ''
    })
  })

  return serializeCsv([header, ...body])
}

/** Visible data columns. Display-only columns such as action buttons have no accessor and are skipped. */
export function getDataTableExportColumns<TData extends object>(table: Table<TData>) {
  return table
    .getVisibleLeafColumns()
    .filter((column) => typeof column.accessorFn !== 'undefined')
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
