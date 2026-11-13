import { useMemo } from 'react'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { invoiceKeys, isInvoiceCursorSort, useInvoiceCursorList, useInvoices } from './sales'
import { scopedOffsetTableProps, useOffsetScopeGate } from './offset-scope-gate'
import type { Invoice } from './types'

export function formatInvoiceCustomerName(invoice: Invoice) {
  const customer = invoice.customer
  if (customer.type === 'COMPANY' && customer.company_name) return customer.company_name
  return `${customer.first_name} ${customer.last_name}`.trim()
}

function matchesSearch(invoice: Invoice, search: string) {
  return [invoice.invoice_number ?? '', formatInvoiceCustomerName(invoice), invoice.status].join(' ').toLowerCase().includes(search)
}

function sortValue(invoice: Invoice, field: string) {
  if (field === 'customer') return formatInvoiceCustomerName(invoice)
  return String((invoice as unknown as Record<string, unknown>)[field] ?? '')
}

/**
 * The unpaged list for the sorts the cursor API does not approve: search, sort and paging happen in the browser.
 * It fetches every invoice in one request, so an offset latch needs no page-1 handoff: the table page is sliced here.
 */
function useUnpagedInvoiceList(queryParams: DataTableQueryParams, enabled: boolean) {
  const scope = useOffsetScopeGate([...invoiceKeys.all, 'unpaged'])
  const query = useInvoices({ enabled: enabled && scope.enabled, scopeDigest: scope.digest })
  const { search, sortField, sortDirection, page, pageSize } = queryParams
  const invoices = useMemo(() => (scope.hidden ? [] : (query.data ?? [])), [scope.hidden, query.data])
  const { dataUpdatedAt } = query
  return useMemo(() => {
    const needle = search?.trim().toLowerCase()
    let rows = needle ? invoices.filter((invoice) => matchesSearch(invoice, needle)) : [...invoices]
    if (sortField) {
      const direction = sortDirection === 'desc' ? -1 : 1
      rows = rows.sort((left, right) => sortValue(left, sortField).localeCompare(sortValue(right, sortField), undefined, { numeric: true }) * direction)
    }
    const start = (page - 1) * pageSize
    return {
      rows: rows.slice(start, start + pageSize),
      dataUpdatedAt,
      tableProps: scopedOffsetTableProps(query, scope, Math.max(1, Math.ceil(rows.length / pageSize))),
    }
  }, [dataUpdatedAt, invoices, query, scope, search, sortField, sortDirection, page, pageSize])
}

/**
 * Rows and `<DataTable>` props of the invoice list: the number and date sorts scroll without pages (cap 2,000 rows,
 * blocks of 50 with a unique-id tiebreaker, so the fiscal order stays stable). Customer, status and total keep the
 * unpaged list with pages. Only the query of the active mode runs.
 */
export function useInvoiceListState(queryParams: DataTableQueryParams) {
  const listParams = {
    search: queryParams.search?.trim() || undefined,
    sortField: queryParams.sortField,
    sortDirection: queryParams.sortDirection,
  }
  const sortEligible = isInvoiceCursorSort(queryParams.sortField)
  const cursorList = useInvoiceCursorList(listParams, sortEligible)
  const offsetLatched = cursorList.tableProps.scopeOffsetLatch === true
  const infiniteMode = sortEligible && !offsetLatched
  const unpaged = useUnpagedInvoiceList(queryParams, !infiniteMode)
  if (infiniteMode) {
    return { rows: cursorList.rows, dataUpdatedAt: cursorList.dataUpdatedAt, tableProps: cursorList.tableProps }
  }
  return unpaged
}
