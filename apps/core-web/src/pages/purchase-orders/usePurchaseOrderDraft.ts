import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useCreatePO } from '@/api/purchase-orders'
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'

type PurchaseOrderDraftSnapshot = {
  vendorId: string
}

/** Creates the purchase order draft for the picked vendor (debounced) and opens it. */
export function usePurchaseOrderDraft(selectedVendorId: string) {
  const { t } = useTranslation('finance')
  const navigate = useNavigate()
  const createPO = useCreatePO()
  const createPORef = useRef(createPO)
  const createdRef = useRef(false)

  useEffect(() => {
    createPORef.current = createPO
  })

  const saveDraft = useCallback(
    async (snapshot: PurchaseOrderDraftSnapshot) => {
      if (!snapshot.vendorId || createdRef.current) return
      const data = await createPORef.current.mutateAsync({
        vendorId: snapshot.vendorId,
        items: [],
      })
      createdRef.current = true
      navigate(`/purchase-orders/${data.id}`)
    },
    [navigate],
  )

  const { saveStatus, triggerAutoSave, clearPendingSave } = useDebouncedAutoSave<PurchaseOrderDraftSnapshot>({
    save: saveDraft,
    shouldSave: (snapshot) => Boolean(snapshot.vendorId),
    onError: (error) => {
      toast.error(t('purchaseOrders.create.createFailed'), {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })

  useEffect(() => {
    if (!selectedVendorId) return
    triggerAutoSave({ vendorId: selectedVendorId })
  }, [selectedVendorId, triggerAutoSave])

  return { saveStatus, triggerAutoSave, clearPendingSave, isPending: createPO.isPending }
}
