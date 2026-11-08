import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'
import { queuePurchaseOrderCreate } from './usePurchaseOrderPendingCreate'

type PurchaseOrderDraftSnapshot = {
  vendorId: string
  vendorName: string
}

/** Hands the picked vendor to the order list, which shows the pending row and creates once. */
export function usePurchaseOrderDraft(selectedVendorId: string, vendorName: string) {
  const navigate = useNavigate()
  const handedOff = useRef(false)
  const [isPending, setIsPending] = useState(false)

  const saveDraft = useCallback(
    async (snapshot: PurchaseOrderDraftSnapshot) => {
      if (!snapshot.vendorId || handedOff.current) return
      handedOff.current = true
      setIsPending(true)
      queuePurchaseOrderCreate(snapshot)
      navigate('/purchase-orders')
    },
    [navigate],
  )

  const { saveStatus, triggerAutoSave, clearPendingSave } = useDebouncedAutoSave<PurchaseOrderDraftSnapshot>({
    save: saveDraft,
    shouldSave: (snapshot) => Boolean(snapshot.vendorId),
  })

  useEffect(() => {
    if (!selectedVendorId) return
    triggerAutoSave({ vendorId: selectedVendorId, vendorName })
  }, [selectedVendorId, vendorName, triggerAutoSave])

  return { saveStatus, triggerAutoSave, clearPendingSave, isPending }
}
