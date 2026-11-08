import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUpdateVendor } from '@/api/vendors'
import type { Vendor } from '@/api/types'
import { isVendorUpdateOptimisticEligible } from '@/features/interaction/parts-purchasing-update-eligibility'
import { useOptimisticFieldSave } from '@/features/interaction/use-optimistic-field-save'
import { getPermissionAwareErrorMessage } from '@/lib/error-utils'

type EditableVendorField = 'name' | 'email' | 'account_number'

function errorToast(error: unknown, fallback: string) {
  toast.error(getPermissionAwareErrorMessage(error, fallback))
}

/** Inline field saves and the optimistic supported-brands update of the vendor detail page. */
export function useVendorDetailActions(vendor: Vendor | undefined) {
  const { t } = useTranslation(['finance', 'common'])
  const updateVendor = useUpdateVendor()
  const fieldSave = useOptimisticFieldSave<EditableVendorField, string>({
    save: (field, value) => {
      if (!vendor) return Promise.reject(new Error('missing vendor'))
      return updateVendor.mutateAsync({ id: vendor.id, data: { [field]: value } })
    },
    isOptimistic: (field, value) => isVendorUpdateOptimisticEligible({ data: { [field]: value } }),
    successMessage: t('vendors.detail.toast.updated', { ns: 'finance' }),
    failureMessage: t('vendors.detail.toast.updateFailed', { ns: 'finance' }),
  })
  const [draftBrands, setDraftBrands] = useState<{ vendorId: string | null; ids: number[] | null }>({
    vendorId: null,
    ids: null,
  })
  const lastRequestId = useRef(0)

  // Use the user's edits only while they belong to the vendor on screen; otherwise show the vendor's own brands.
  const brandIds =
    draftBrands.vendorId === vendor?.id && draftBrands.ids !== null
      ? draftBrands.ids
      : (vendor?.supportedBrands?.map((b) => b.id) ?? [])

  const saveField = (field: EditableVendorField, nextValue: string) => {
    if (!vendor) return
    return fieldSave.saveField(field, nextValue)
  }

  const changeBrands = async (nextIds: number[]) => {
    if (!vendor) return
    const requestId = ++lastRequestId.current
    const previousBrandIds = brandIds

    // Optimistic update with vendorId keying
    setDraftBrands({ vendorId: vendor.id, ids: nextIds })

    try {
      await updateVendor.mutateAsync({ id: vendor.id, data: { brandIds: nextIds } })
      if (requestId === lastRequestId.current) {
        toast.success(t('vendors.detail.toast.brandsUpdated', { ns: 'finance' }))
      }
    } catch (updateError: unknown) {
      // Only roll back if this was the latest request
      if (requestId !== lastRequestId.current) return
      setDraftBrands({ vendorId: vendor.id, ids: previousBrandIds })
      errorToast(updateError, t('vendors.detail.toast.brandsUpdateFailed', { ns: 'finance' }))
    }
  }

  return {
    brandIds,
    saveField,
    changeBrands,
    isUpdating: updateVendor.isPending,
    failures: fieldSave.failures,
    retryField: fieldSave.retry,
    dismissField: fieldSave.dismiss,
  }
}
