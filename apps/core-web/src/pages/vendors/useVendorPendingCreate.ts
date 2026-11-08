import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useCreateVendor } from '@/api/vendors'
import type { Vendor } from '@/api/types'
import { describePendingCreateError, useListPendingCreate } from '@/features/interaction/use-list-pending-create'

export type VendorCreateRequest = {
  name: string
  email: string
  account_number: string
  brandIds: number[]
}

/** The entered name and email only. The account number and brands wait for the server. */
function buildPendingVendor(localId: string, payload: VendorCreateRequest): Vendor {
  return {
    id: localId,
    name: payload.name,
    email: payload.email,
    account_number: '',
    supportedBrands: [],
    createdAt: '',
    updatedAt: '',
  }
}

/** Vendor create stays server-confirmed behind a pending list row (ADR-0036 R1). */
export function useVendorPendingCreate(serverRows: Vendor[], dataUpdatedAt: number) {
  const { t } = useTranslation('finance')
  const createVendor = useCreateVendor()
  return useListPendingCreate<VendorCreateRequest, Vendor>({
    create: createVendor.mutateAsync,
    buildRow: buildPendingVendor,
    serverRows,
    dataUpdatedAt,
    describeError: (error) =>
      describePendingCreateError(error, {
        unconfirmed: t('vendors.dialog.createUnconfirmed'),
        failed: t('vendors.dialog.createFailed'),
      }),
    onCreated: () => toast.success(t('vendors.dialog.created')),
  })
}
