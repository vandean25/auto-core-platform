import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'

import { serializeCsv } from '@/lib/csv'
import { getDataTableColumnLabel } from './data-table-column-label'

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
 * Serialises the cells the table is rendering right now, as the user reads them: formatted amounts,
 * names and labels, not the raw record values. Server-paged lists therefore export the loaded page.
 */
export function buildDataTableCsv<TData extends object>(table: Table<TData>, root: Element | null): string {
  const columns = getDataTableExportColumns(table)
  const renderedRows = root ? Array.from(root.querySelectorAll('tbody tr[data-table-row]')) : []
  const cellTexts = renderedRows.map((row) => {
    const cells = Array.from(row.children)
    return columns.map((column) => {
      const cell = cells.find((candidate) => candidate.getAttribute('data-column-id') === column.id)
      return cell ? readDisplayedText(cell).replace(/\s+/g, ' ').trim() : ''
    })
  })
  // A column without an accessor is data only if it shows text, which leaves out icon and checkbox columns.
  const keep = columns.map((column, index) => typeof column.accessorFn !== 'undefined' || cellTexts.some((texts) => texts[index] !== ''))
  const header = columns.filter((_, index) => keep[index]).map((column) => getDataTableColumnLabel(column))
  const body = cellTexts.map((texts) => texts.filter((_, index) => keep[index]))

  return serializeCsv([header, ...body])
}

/** Visible columns that can hold data. The actions column is left out; icon and checkbox columns drop out when exporting. */
export function getDataTableExportColumns<TData extends object>(table: Table<TData>) {
  return table
    .getVisibleLeafColumns()
    .filter((column) => column.id !== 'actions' || typeof column.accessorFn !== 'undefined')
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
