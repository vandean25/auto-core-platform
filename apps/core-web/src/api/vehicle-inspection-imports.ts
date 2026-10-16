import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'
import { vehicleKeys } from '@/api/vehicles'

export type InspectionImportPreview =
  components['schemas']['InspectionImportPreviewResponseDto']

export function useInspectionSourceConnections() {
  return useQuery({
    queryKey: ['inspection-source-connections'],
    queryFn: async () => {
      const response = await fetchWithAuth('/api/inspection-source-connections')
      if (!response.ok) {
        throw new Error('Failed to load inspection connections')
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
    queryKey: [...vehicleKeys.detail(vehicleId), 'inspection-imports'],
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/inspection-imports?limit=20`,
      )
      if (!response.ok) {
        throw new Error('Failed to load inspection imports')
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
        throw new Error(
          typeof payload?.code === 'string' ? payload.code : 'Preview failed',
        )
      }
      return payload as InspectionImportPreview
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...vehicleKeys.detail(vehicleId), 'inspection-imports'],
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
        throw new Error(
          typeof payload?.code === 'string' ? payload.code : 'Apply failed',
        )
      }
      return payload
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.detail(vehicleId) })
      queryClient.invalidateQueries({
        queryKey: [...vehicleKeys.detail(vehicleId), 'inspection-records'],
      })
      queryClient.invalidateQueries({ queryKey: vehicleKeys.pickerlDueAll() })
    },
  })
}
