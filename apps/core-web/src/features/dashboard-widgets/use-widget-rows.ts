import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { dashboardWidgetKeys } from '@/features/dashboard-widgets/dashboard-widget-keys'
import {
  fetchWidgetRows,
  filterWidgetRows,
  resolveWidgetRequest,
  type WidgetRowsResult,
} from '@/features/dashboard-widgets/data-source-registry'
import type { DashboardWidget } from '@/features/dashboard-widgets/types'
import { type WidgetData } from '@/features/dashboard-widgets/widget-totals'
import { hasUtcDayChanged } from '@/lib/date-utils'

const PICKERL_DUE_SOURCE_KEY = 'pickerl-due'
const NO_ROWS: WidgetRowsResult = { rows: [], total: 0 }

/** Widgets on the same source and API URL share one request; their own filters are applied to the shared rows. */
export function useWidgetRows(widget: DashboardWidget) {
  const request = useMemo(() => resolveWidgetRequest(widget.href), [widget.href])
  const select = useCallback(
    (result: WidgetRowsResult): WidgetData => ({
      rows: filterWidgetRows(result.rows, request),
      fetchedCount: result.rows.length,
      total: result.total,
      hasClientFilters: request?.hasClientOnlyFilters ?? false,
    }),
    [request],
  )

  return useQuery({
    queryKey: dashboardWidgetKeys.rows(widget.sourceKey, request?.apiUrl ?? widget.href),
    queryFn: () => (request ? fetchWidgetRows(request.apiUrl, widget.sourceKey) : NO_ROWS),
    select,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: (query) =>
      widget.sourceKey === PICKERL_DUE_SOURCE_KEY && hasUtcDayChanged(query.state.dataUpdatedAt) ? 'always' : false,
  })
}
