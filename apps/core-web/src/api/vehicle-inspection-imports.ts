import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'
import { vehicleKeys } from '@/api/vehicles'
import { vehicleInspectionKeys } from '@/api/vehicle-inspection-records'

export const inspectionImportKeys = {
  all: ['inspection-imports'] as const,
  sourceConnections: () =>
    [...inspectionImportKeys.all, 'source-connections'] as const,
  vehicleImports: (vehicleId: string) =>
    [...vehicleKeys.detail(vehicleId), 'inspection-imports'] as const,
}

export type InspectionImportPreview =
  components['schemas']['InspectionImportPreviewResponseDto']

export function useInspectionSourceConnections() {
  return useQuery({
    queryKey: inspectionImportKeys.sourceConnections(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/inspection-source-connections')
      if (!response.ok) {
        throw new Error('INSPECTION_CONNECTIONS_LOAD_FAILED')
      }
      return response.json() as Promise<{
        data: Array<{
          id: string
          source_account_ref: string
          source_station_id: string
          profile_id: string
        }>
      }>
    },
  })
}

export function useInspectionImports(vehicleId: string) {
  return useQuery({
    queryKey: inspectionImportKeys.vehicleImports(vehicleId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/inspection-imports?limit=20`,
      )
      if (!response.ok) {
        throw new Error('INSPECTION_IMPORTS_LOAD_FAILED')
      }
      return response.json() as Promise<{
        data: Array<{
          id: string
          state: string
          native_result_reference: string
          error_code?: string | null
        }>
      }>
    },
  })
}

export function usePreviewInspectionImport(vehicleId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: components['schemas']['PreviewInspectionImportDto']) => {
      const response = await fetchWithAuth(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/inspection-imports/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const code =
          typeof payload?.code === 'string' ? payload.code : 'PREVIEW_FAILED'
        throw new Error(code)
      }
      return payload as InspectionImportPreview
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: inspectionImportKeys.vehicleImports(vehicleId),
      })
    },
  })
}

export function useApplyInspectionImport(vehicleId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      importId: string
      fingerprint: string
      version: number
    }) => {
      const response = await fetchWithAuth(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/inspection-imports/${encodeURIComponent(params.importId)}/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fingerprint: params.fingerprint,
            version: params.version,
          }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const code =
          typeof payload?.code === 'string' ? payload.code : 'APPLY_FAILED'
        throw new Error(code)
      }
      return payload
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.detail(vehicleId) })
      queryClient.invalidateQueries({
        queryKey: vehicleInspectionKeys.all(vehicleId),
      })
      queryClient.invalidateQueries({ queryKey: vehicleKeys.pickerlDueAll() })
    },
  })
}
