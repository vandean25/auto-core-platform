import { useQuery } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { components, operations } from './generated/openapi'

export type WorkshopKpiReportRow = components['schemas']['WorkshopKpiReportRowDto']
export type WorkshopKpiReport = components['schemas']['WorkshopKpiReportResponseDto']

export type WorkshopKpiReportFilters = operations['WorkshopKpiReportsController_getWorkshopKpis']['parameters']['query']

export const workshopKpiReportKeys = {
  all: ['workshop-kpi-reports'] as const,
  report: (filters: WorkshopKpiReportFilters) => [...workshopKpiReportKeys.all, filters] as const,
}

export function useWorkshopKpiReport(filters: WorkshopKpiReportFilters, enabled = true) {
  return useQuery({
    queryKey: workshopKpiReportKeys.report(filters),
    enabled: enabled && Boolean(filters.siteId && filters.from && filters.to),
    queryFn: async (): Promise<WorkshopKpiReport> => {
      const params = new URLSearchParams(filters)
      const response = await fetchWithAuth(`/api/reports/workshop-kpis?${params}`)
      if (!response.ok) throw new Error('Workshop-KPI-Bericht konnte nicht geladen werden')
      return response.json() as Promise<WorkshopKpiReport>
    },
  })
}
