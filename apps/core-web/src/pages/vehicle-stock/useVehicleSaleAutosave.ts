import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  useCreateVehicleSale,
  useUpdateVehicleSale,
  type VehicleSale,
} from '@/api/vehicle-stock'
import { getErrorMessage } from '@/lib/error-utils'
import { shorteningSaveErrorMessage } from '@/lib/vehicle-sale-warranty'
import { storedSaleSerialized, type VehicleSaleDraftFacts } from './vehicle-sale-draft'

const AUTO_SAVE_DEBOUNCE_MS = 750

type CreateSale = ReturnType<typeof useCreateVehicleSale>['mutateAsync']
type UpdateSale = ReturnType<typeof useUpdateVehicleSale>['mutateAsync']

/** Creates the sale on its first save and updates it afterwards. Returns the id of a sale it created. */
async function saveSaleFacts(
  saleId: string,
  saleFacts: VehicleSaleDraftFacts,
  createSale: CreateSale,
  updateSale: UpdateSale,
): Promise<string | null> {
  if (!saleId) {
    const created = await createSale({
      vehicle_id: saleFacts.vehicle_id,
      customer_id: saleFacts.customer_id,
      sale_price: saleFacts.sale_price,
      contract_concluded_at: saleFacts.contract_concluded_at ?? undefined,
      handed_over_at: saleFacts.handed_over_at ?? undefined,
      buyer_is_consumer: saleFacts.buyer_is_consumer,
      gewaehrleistung_shortened_negotiated:
        saleFacts.gewaehrleistung_shortened_negotiated,
      gewaehrleistung_note: saleFacts.gewaehrleistung_note,
      garantie_months: saleFacts.garantie_months,
      garantie_terms: saleFacts.garantie_terms,
    })
    return created.id
  }
  await updateSale({
    id: saleId,
    data: {
      customer_id: saleFacts.customer_id,
      sale_price: saleFacts.sale_price,
      contract_concluded_at: saleFacts.contract_concluded_at,
      handed_over_at: saleFacts.handed_over_at,
      buyer_is_consumer: saleFacts.buyer_is_consumer,
      gewaehrleistung_shortened_negotiated:
        saleFacts.gewaehrleistung_shortened_negotiated,
      gewaehrleistung_note: saleFacts.gewaehrleistung_note,
      garantie_months: saleFacts.garantie_months,
      garantie_terms: saleFacts.garantie_terms,
    },
  })
  return null
}

/** Saves run one after another, so an older save never overwrites a newer one. Tracks the saved sale and its status. */
function useVehicleSaleSaves(routeSaleId: string, existing: VehicleSale | undefined) {
  const navigate = useNavigate()
  const { mutateAsync: createSale } = useCreateVehicleSale()
  const { mutateAsync: updateSale } = useUpdateVehicleSale()
  const [saleId, setSaleId] = useState(routeSaleId === 'new' ? '' : routeSaleId)
  const saleIdRef = useRef(saleId)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [shorteningSaveError, setShorteningSaveError] = useState<string | null>(null)
  const lastSavedSerialized = useRef<string | null>(null)
  const hydratedSaleId = useRef<string | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())

  const persistSaleFacts = useCallback(async (
    saleFacts: VehicleSaleDraftFacts,
    serialized: string,
  ) => {
    const saveOperation = saveQueue.current.catch(() => undefined).then(async () => {
      setSaveStatus('saving')
      try {
        const createdId = await saveSaleFacts(saleIdRef.current, saleFacts, createSale, updateSale)
        if (createdId) {
          saleIdRef.current = createdId
          setSaleId(createdId)
          navigate(`/vehicle-stock/sales/${createdId}`, { replace: true })
        }
        lastSavedSerialized.current = serialized
        setSaveStatus('saved')
        setShorteningSaveError(null)
      } catch (error) {
        setSaveStatus('error')
        setShorteningSaveError(shorteningSaveErrorMessage(error))
        throw error
      }
    })
    saveQueue.current = saveOperation
    return saveOperation
  }, [createSale, updateSale, navigate])

  useEffect(() => {
    if (!existing || hydratedSaleId.current === existing.id) return
    hydratedSaleId.current = existing.id
    saleIdRef.current = existing.id
    setSaleId(existing.id)
    lastSavedSerialized.current = storedSaleSerialized(existing)
  }, [existing])

  return {
    saleId,
    saleIdRef,
    saveStatus,
    shorteningSaveError,
    setShorteningSaveError,
    lastSavedSerialized,
    persistSaleFacts,
  }
}

export type VehicleSaleDraft = ReturnType<typeof useVehicleSaleAutosave>

/** Saves the sale draft 750 ms after the last change, and on demand before an action that needs the saved facts. */
export function useVehicleSaleAutosave({
  routeSaleId,
  existing,
  facts,
  enabled,
}: {
  routeSaleId: string
  existing: VehicleSale | undefined
  facts: VehicleSaleDraftFacts
  enabled: boolean
}) {
  const { t } = useTranslation('vehicleStock')
  const { lastSavedSerialized, persistSaleFacts, ...saves } = useVehicleSaleSaves(routeSaleId, existing)
  const { saleId } = saves
  const saveTimer = useRef<number | null>(null)
  const pendingSave = useRef<Promise<void> | null>(null)

  useEffect(() => {
    if (!enabled) return
    const serialized = JSON.stringify(facts)
    if (serialized === lastSavedSerialized.current) return
    const handle = window.setTimeout(() => {
      saveTimer.current = null
      const saveRequest = persistSaleFacts(facts, serialized)
      pendingSave.current = saveRequest
      void saveRequest
        .catch((error) => toast.error(getErrorMessage(error, t('sale.saveFailed'))))
        .finally(() => {
          if (pendingSave.current === saveRequest) pendingSave.current = null
        })
    }, AUTO_SAVE_DEBOUNCE_MS)
    saveTimer.current = handle
    return () => {
      window.clearTimeout(handle)
      if (saveTimer.current === handle) saveTimer.current = null
    }
  }, [enabled, facts, saleId, lastSavedSerialized, persistSaleFacts])

  /** Cancels a save still inside the debounce window and waits for the one already running. */
  const settlePendingSave = async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (pendingSave.current) await pendingSave.current
  }

  const saveIfChanged = async () => {
    const serialized = JSON.stringify(facts)
    if (serialized !== lastSavedSerialized.current) {
      await persistSaleFacts(facts, serialized)
    }
  }

  return { ...saves, settlePendingSave, saveIfChanged }
}
