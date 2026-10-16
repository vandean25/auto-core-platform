import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'
export const measurementKeys = {
  all: ['workshop-measurements'] as const,
  deviceSources: () => [...measurementKeys.all, 'device-sources'] as const,
  order: (orderId: string) =>
    [...measurementKeys.all, 'order', orderId, 'measurements'] as const,
}

export type MeasurementImportPreview =
  components['schemas']['MeasurementImportPreviewResponseDto']

export function useInspectionDeviceSources() {
  return useQuery({
    queryKey: measurementKeys.deviceSources(),
    queryFn: async () => {
      const response = await fetchWithAuth(
        '/api/workshop-orders/inspection-device-sources',
      )
      if (!response.ok) {
        throw new Error('DEVICE_SOURCES_LOAD_FAILED')
      }
      return response.json() as Promise<{
        data: Array<{
          id: string
          source_instance_id: string
          device_serial: string
          device_model: string
          profile_id: string
          binding_revision: number
        }>
      }>
    },
  })
}

export function useWorkshopMeasurements(orderId: string) {
  return useQuery({
    queryKey: measurementKeys.order(orderId),
    enabled: Boolean(orderId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/workshop-orders/${encodeURIComponent(orderId)}/measurements?limit=50`,
      )
      if (!response.ok) {
        throw new Error('MEASUREMENTS_LOAD_FAILED')
      }
      return response.json() as Promise<{
        data: components['schemas']['MeasurementImportListItemDto'][]
        meta: components['schemas']['PaginationMetaDto']
      }>
    },
  })
}

export function usePreviewWorkshopMeasurement(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      body: components['schemas']['PreviewMeasurementImportDto'],
    ) => {
      const response = await fetchWithAuth(
        `/api/workshop-orders/${encodeURIComponent(orderId)}/measurements/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!response.ok) {
        const bodyText = await response.text()
        throw new Error(bodyText || 'MEASUREMENT_PREVIEW_FAILED')
      }
      return response.json() as Promise<MeasurementImportPreview>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: measurementKeys.order(orderId) })
    },
  })
}

export function useApplyWorkshopMeasurement(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      importId: string
      fingerprint: string
      version: number
    }) => {
      const response = await fetchWithAuth(
        `/api/workshop-orders/${encodeURIComponent(orderId)}/measurements/${encodeURIComponent(params.importId)}/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fingerprint: params.fingerprint,
            version: params.version,
          }),
        },
      )
      if (!response.ok) {
        const bodyText = await response.text()
        throw new Error(bodyText || 'MEASUREMENT_APPLY_FAILED')
      }
      return response.json() as Promise<
        components['schemas']['ApplyMeasurementImportResponseDto']
      >
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: measurementKeys.order(orderId) })
    },
  })
}
