import { useQuery } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'

export type VehicleMediaDto = components['schemas']['VehicleMediaDto']

export const vehicleStockPhotoKeys = {
  all: ['vehicle-stock-photos'] as const,
  list: (vehicleId: string) => [...vehicleStockPhotoKeys.all, vehicleId] as const,
}

export function useVehicleStockPhotos(vehicleId: string) {
  return useQuery({
    queryKey: vehicleStockPhotoKeys.list(vehicleId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}/photos`)
      if (!response.ok) {
        throw new Error('Failed to load vehicle photos')
      }
      return response.json() as Promise<VehicleMediaDto[]>
    },
    enabled: Boolean(vehicleId),
  })
}
