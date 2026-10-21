import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useCatalogProviderSettings } from '@/api/useCatalogProviderSettings'
import { useResolveVehicleIdentity, useVehicle } from '@/api/vehicles'
import type { WorkshopOrder } from '@/api/types'
import {
  createEmptyCatalogSearchSession,
  findOemConcernForMakeBrandId,
  isVehicleIdentityStale,
  type CatalogSearchSession,
  type CatalogSourceMetadata,
} from '@/features/workshop/catalog-source-copy'
import { getErrorMessage } from '../utils/error'

/** Fitment search of one task: the open modal's props, the catalog source banner state and the OEM concern of the vehicle. */
export function useWorkshopFitmentSearch(order: WorkshopOrder) {
  const { t } = useTranslation('workshop')
  const resolveIdentity = useResolveVehicleIdentity()
  const { data: vehicleIdentity } = useVehicle(order.vehicle.id)
  const { data: catalogProviderSettings } = useCatalogProviderSettings()
  const [catalogSearchSession, setCatalogSearchSession] =
    useState<CatalogSearchSession>(createEmptyCatalogSearchSession)
  const [fitmentSearchTaskId, setFitmentSearchTaskId] = useState<string | null>(null)

  const oemConcern = findOemConcernForMakeBrandId(
    vehicleIdentity?.make_brand_id,
    catalogProviderSettings?.oemConcerns,
  )
  const oemConcernCode = oemConcern?.code ?? null

  const handleCatalogSearchSessionUpdate = (metadata: CatalogSourceMetadata) => {
    setCatalogSearchSession((previous) => ({
      ...previous,
      [metadata.concern === 'PARTS' ? 'parts' : 'labor']: metadata,
    }))
  }

  const handleRequestResolveIdentity = () => {
    setFitmentSearchTaskId(null)
    const vehicleId = order.vehicle.id
    if (!vehicleId) return
    void resolveIdentity
      .mutateAsync(vehicleId)
      .then(() => {
        toast.success(t('orderDetail.toast.vehicleIdentityResolved'))
      })
      .catch((error: unknown) => {
        toast.error(
          getErrorMessage(error, t('orderDetail.toast.vehicleIdentityResolveFailed')),
        )
      })
  }

  const modalProps = fitmentSearchTaskId
    ? {
        open: true,
        onOpenChange: (open: boolean) => {
          if (!open) setFitmentSearchTaskId(null)
        },
        workshopOrderId: order.id,
        taskId: fitmentSearchTaskId,
        vehicleId: order.vehicle.id,
        oemConcernCode,
        isIdentityStale: isVehicleIdentityStale(vehicleIdentity),
        onSearchSessionUpdate: handleCatalogSearchSessionUpdate,
        onRequestResolveIdentity: handleRequestResolveIdentity,
      }
    : null

  return {
    catalogSearchSession,
    oemConcernCode,
    openFitmentSearch: setFitmentSearchTaskId,
    modalProps,
  }
}
