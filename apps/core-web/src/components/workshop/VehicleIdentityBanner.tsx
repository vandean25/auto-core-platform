import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useCatalogProviderSettings } from '@/api/useCatalogProviderSettings'
import { useResolveVehicleIdentity, useVehicle } from '@/api/vehicles'
import type { Vehicle } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  findOemConcernForMakeBrandId,
  formatIdentityKeys,
  getOemConcernLabel,
  isVehicleIdentityStale,
} from '@/features/workshop/catalog-source-copy'

export interface VehicleIdentityBannerProps {
  vehicleId: string
  onIdentityResolved?: (vehicle: Vehicle) => void
}

export function VehicleIdentityBanner({
  vehicleId,
  onIdentityResolved,
}: VehicleIdentityBannerProps) {
  const { data: vehicle, isLoading: isVehicleLoading } = useVehicle(vehicleId)
  const { data: catalogSettings } = useCatalogProviderSettings()
  const resolveIdentity = useResolveVehicleIdentity()

  const oemConcern = findOemConcernForMakeBrandId(
    vehicle?.make_brand_id,
    catalogSettings?.oemConcerns,
  )
  const identityStale = isVehicleIdentityStale(vehicle)
  const isResolving = resolveIdentity.isPending

  async function handleResolveIdentity() {
    if (!vehicleId) return
    try {
      const resolvedVehicle = await resolveIdentity.mutateAsync(vehicleId)
      toast.success('Vehicle identity resolved')
      onIdentityResolved?.(resolvedVehicle)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to resolve vehicle identity'
      toast.error(message)
    }
  }

  if (isVehicleLoading) {
    return (
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' />
        Loading vehicle identity...
      </div>
    )
  }

  if (!vehicle) {
    return null
  }

  return (
    <div
      className='rounded-lg border bg-muted/30 px-3 py-2.5'
      data-testid='vehicle-identity-banner'
    >
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div className='space-y-2 min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-sm font-medium'>Vehicle identity</span>
            {identityStale ? (
              <Badge variant='destructive'>Stale — re-resolve required</Badge>
            ) : (
              <Badge variant='secondary'>Resolved</Badge>
            )}
            {oemConcern && (
              <Badge variant='outline'>OEM {getOemConcernLabel(oemConcern.code)}</Badge>
            )}
            {vehicle.make_brand_id != null && (
              <Badge variant='outline'>{vehicle.make}</Badge>
            )}
          </div>
          <p className='text-xs text-muted-foreground break-words'>
            Keys: {formatIdentityKeys(vehicle.identity_keys)}
          </p>
          {vehicle.identity_resolved_at && (
            <p className='text-xs text-muted-foreground'>
              Resolved {new Date(vehicle.identity_resolved_at).toLocaleString()}
            </p>
          )}
          {!vehicle.vin && (
            <p className='text-xs text-amber-700'>
              VIN is required before identity can be resolved.
            </p>
          )}
        </div>

        <Button
          type='button'
          variant={identityStale ? 'default' : 'outline'}
          size='sm'
          className='shrink-0'
          onClick={() => void handleResolveIdentity()}
          disabled={!vehicle.vin || isResolving}
          data-testid='resolve-vehicle-identity-button'
        >
          {isResolving ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <RefreshCw className='mr-2 h-4 w-4' />
          )}
          {identityStale ? 'Re-resolve identity' : 'Re-resolve'}
        </Button>
      </div>
    </div>
  )
}
