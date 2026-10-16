import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'

type CatalogueReferenceResolution =
  components['schemas']['CatalogueReferenceResolutionDto']
type InspectionFindingReference =
  components['schemas']['InspectionFindingReferenceResponseDto']

export const inspectionCatalogueKeys = {
  all: ['inspection-catalogues'] as const,
  references: (positionId: string, vehicleClass?: string) =>
    [
      ...inspectionCatalogueKeys.all,
      'references',
      positionId,
      vehicleClass ?? '',
    ] as const,
  inspectionReferences: (inspectionId: string) =>
    [
      ...inspectionCatalogueKeys.all,
      'inspection',
      inspectionId,
    ] as const,
}

export function useCatalogueReferenceResolution(
  positionId: string,
  vehicleClass?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: inspectionCatalogueKeys.references(positionId, vehicleClass),
    enabled: enabled && positionId.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({
        position_id: positionId,
        ...(vehicleClass ? { vehicle_class: vehicleClass } : {}),
      })
      const response = await fetchWithAuth(
        `/api/inspection-catalogues/references?${params.toString()}`,
      )
      if (!response.ok) {
        throw new Error('CATALOGUE_REFERENCE_LOAD_FAILED')
      }
      const body = (await response.json()) as {
        data: CatalogueReferenceResolution[]
      }
      return body.data[0] ?? null
    },
  })
}

export function useInspectionCatalogueReferences(inspectionId: string) {
  return useQuery({
    queryKey: inspectionCatalogueKeys.inspectionReferences(inspectionId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/workshop-inspections/${encodeURIComponent(inspectionId)}/catalogue-references`,
      )
      if (!response.ok) {
        throw new Error('CATALOGUE_REFERENCES_LOAD_FAILED')
      }
      const body = (await response.json()) as {
        data: InspectionFindingReference[]
      }
      return body.data
    },
  })
}

export function useAttachCatalogueReference() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      workshop_order_id: string
      workshop_task_id: string
      position_id: string
      entry_id?: string | null
      human_finding_label?: string | null
    }) => {
      const response = await fetchWithAuth(
        '/api/inspection-catalogues/finding-references',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        throw new Error('CATALOGUE_REFERENCE_ATTACH_FAILED')
      }
      return (await response.json()) as InspectionFindingReference
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: inspectionCatalogueKeys.all,
      })
    },
  })
}
