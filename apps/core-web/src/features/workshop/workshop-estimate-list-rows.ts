import type { WorkshopEstimateListRow } from '@/api/workshop-estimates'
import { normalizeForSearch } from '@/lib/format'

const SORT_FIELDS = [
  'estimate_number',
  'order_number',
  'customer_name',
  'vehicle_plate',
  'status',
  'sent_at',
  'valid_until',
  'total_gross',
] as const

const SEARCH_FIELDS = ['estimate_number', 'order_number', 'customer_name', 'vehicle_plate'] as const

/** Search over what the table shows (number, work order, customer, plate) plus the status label. */
export function filterEstimateRows<T extends WorkshopEstimateListRow>(
  rows: T[],
  search: string | undefined,
  statusLabel: (status: T['status']) => string,
): T[] {
  const needle = normalizeForSearch((search ?? '').trim())
  if (!needle) return rows
  return rows.filter((row) =>
    [...SEARCH_FIELDS.map((field) => row[field]), statusLabel(row.status)].some((value) =>
      normalizeForSearch(value ?? '').includes(needle),
    ),
  )
}

function compareValues(left: string | null, right: string | null, numeric: boolean): number {
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
  return numeric ? Number(left) - Number(right) : left.localeCompare(right, 'de')
}

/** Sorts the loaded rows; empty values stay last in either direction. */
export function sortEstimateRows<T extends WorkshopEstimateListRow>(
  rows: T[],
  field: string | undefined,
  direction: 'asc' | 'desc' | undefined,
): T[] {
  const key = SORT_FIELDS.find((candidate) => candidate === field)
  if (!key) return rows
  const sign = direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const left = a[key] === null ? null : String(a[key])
    const right = b[key] === null ? null : String(b[key])
    if (left === null || right === null) return compareValues(left, right, false)
    return sign * compareValues(left, right, key === 'total_gross')
  })
}
