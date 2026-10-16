import { useQuery } from '@tanstack/react-query'

import { fetchWithAuth, getErrorMessage } from '@/api/fetch-with-auth'
import type { components } from '@/api/generated/openapi'

export type InspectorEvidenceRevision =
  components['schemas']['InspectorEvidenceRevisionResponseDto']
export type InspectorEvidenceAssessment =
  components['schemas']['InspectorEvidenceAssessmentResponseDto']

export const inspectorEvidenceKeys = {
  all: ['inspector-evidence'] as const,
  list: (employeeId: string) =>
    [...inspectorEvidenceKeys.all, 'list', employeeId] as const,
  assessment: (employeeId: string, stationRef: string) =>
    [...inspectorEvidenceKeys.all, 'assessment', employeeId, stationRef] as const,
}

export function useInspectorEvidenceList(employeeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: inspectorEvidenceKeys.list(employeeId ?? ''),
    enabled: Boolean(employeeId) && enabled,
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/employees/${employeeId}/inspection-evidence?limit=50`,
      )
      if (!response.ok) {
        throw new Error(
          await getErrorMessage(response, 'Failed to fetch inspector evidence'),
        )
      }
      return (await response.json()) as {
        data: InspectorEvidenceRevision[]
        meta: { total: number }
      }
    },
  })
}

export function useInspectorEvidenceAssessment(
  employeeId: string | null,
  stationRef: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: inspectorEvidenceKeys.assessment(employeeId ?? '', stationRef),
    enabled: Boolean(employeeId) && enabled && Boolean(stationRef),
    queryFn: async () => {
      const params = new URLSearchParams({
        station_ref: stationRef,
        vehicle_class: 'M1',
      })
      const response = await fetchWithAuth(
        `/api/employees/${employeeId}/inspection-evidence/assessment?${params.toString()}`,
      )
      if (!response.ok) {
        throw new Error(
          await getErrorMessage(response, 'Failed to assess inspector evidence'),
        )
      }
      return (await response.json()) as InspectorEvidenceAssessment
    },
  })
}
