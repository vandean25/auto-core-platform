import type { DashboardWidget } from '@/features/dashboard-widgets/types'

/** The rows a widget shows, with how they relate to the server's total for the request. */
export type WidgetData = {
  /** The rows after the widget's own client-side filters. */
  rows: unknown[]
  /** The rows the request returned, before those filters. */
  fetchedCount: number
  /** The matches the server reports for the request (`meta.total`). */
  total: number
  /** The client narrows the rows by a `filter_*` value or a search the server total does not reflect. */
  hasClientFilters: boolean
}

/** The request returned only one page of a longer result, so anything computed from the rows alone is partial. */
export function isTruncated({ fetchedCount, total }: Pick<WidgetData, 'fetchedCount' | 'total'>): boolean {
  return total > fetchedCount
}

/**
 * The number a count widget shows. Over a truncated page the server's total is exact only when nothing narrowed the
 * rows on the client: nothing the server total does not reflect (`filter_*` values, a search the API request does not
 * carry) and no row dropped.
 * Otherwise only a lower bound is known, and the widget says so.
 */
export function widgetCount(data: WidgetData): { value: number; isLowerBound: boolean } {
  if (!isTruncated(data)) return { value: data.rows.length, isLowerBound: false }
  if (!data.hasClientFilters && data.rows.length === data.fetchedCount) return { value: data.total, isLowerBound: false }
  return { value: data.rows.length, isLowerBound: true }
}

/**
 * Sums and groups are computed from the fetched rows only, so a longer result makes them partial. A count is partial
 * only when the widget's own client-side filters narrowed a truncated page.
 */
export function isPartialResult(widget: DashboardWidget, data: WidgetData): boolean {
  if (!isTruncated(data)) return false
  if (widget.displayType === 'donut') return true
  if (widget.displayType !== 'metric') return false
  return (widget.metricCalculation === 'sum' && Boolean(widget.metricField)) || widgetCount(data).isLowerBound
}
