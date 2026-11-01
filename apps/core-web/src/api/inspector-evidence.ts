import { i18n } from '@/lib/i18n'
import { useQuery } from '@tanstack/react-query'

import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'
import { getErrorMessageFromResponse as getErrorMessage } from '@/lib/error-utils'


export type InspectorEvidenceRevision =
  components['schemas']['InspectorEvidenceRevisionResponseDto']
export type InspectorEvidenceAssessment =
  components['schemas']['InspectorEvidenceAssessmentResponseDto']

export const inspectorEvidenceKeys = {
  all: ['inspector-evidence'] as const,
  list: (employeeId: string) =>
    [...inspectorEvidenceKeys.all, 'list', employeeId] as const,
  assessment: (employeeId: string, stationRef: string, vehicleClass?: string) =>
    [
      ...inspectorEvidenceKeys.all,
      'assessment',
      employeeId,
      stationRef,
      vehicleClass ?? '',
    ] as const,
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
          await getErrorMessage(response, i18n.t('common:apiErrors.workshop.inspectorEvidence.loadFailed')),
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
  vehicleClass: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: inspectorEvidenceKeys.assessment(
      employeeId ?? '',
      stationRef,
      vehicleClass ?? undefined,
    ),
    enabled: Boolean(employeeId) && enabled && Boolean(stationRef),
    queryFn: async () => {
      const params = new URLSearchParams({
        station_ref: stationRef,
      })
      if (vehicleClass) {
        params.set('vehicle_class', vehicleClass)
      }
      const response = await fetchWithAuth(
        `/api/employees/${employeeId}/inspection-evidence/assessment?${params.toString()}`,
      )
      if (!response.ok) {
        throw new Error(
          await getErrorMessage(response, i18n.t('common:apiErrors.workshop.inspectorEvidence.assessFailed')),
        )
      }
      return (await response.json()) as InspectorEvidenceAssessment
    },
  })
}
