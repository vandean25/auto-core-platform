import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthSession } from '@/api/auth-session'
import { useAuth } from '@/auth/AuthProvider'
import { useInventory } from '@/api/inventory'
import type { StorageLocation } from '@/api/locations'
import { useMySites } from '@/api/sites'
import {
  useApproveStockTransfer,
  useCancelStockTransfer,
  useReceiveStockTransfer,
  useRejectStockTransfer,
  useReturnStockTransfer,
  useShipStockTransfer,
} from '@/api/stock-transfers'
import type { StockTransfer } from '@/api/stock-transfers'
import { generateId } from '@/lib/id'
import { getErrorMessage } from '@/lib/error-utils'
import {
  buildReceiveLines,
  buildReturnLines,
  buildShipLines,
  getTransferAccess,
} from './stock-transfer-detail-logic'
import type { TransferAccess } from './stock-transfer-detail-logic'
import { buildMemberSiteIdSet, getLinesMissingShipSourceBins } from './stock-transfer-permissions'

type QtyByLine = Record<string, string>

async function runAction(
  successMessage: string,
  failureMessage: string,
  action: () => Promise<unknown>,
) {
  try {
    await action()
    toast.success(successMessage)
  } catch (actionError: unknown) {
    toast.error(getErrorMessage(actionError, failureMessage))
  }
}

/** Who is viewing and what they may do with the transfer. */
export function useTransferAccess(id: string, transfer: StockTransfer | undefined) {
  const { user } = useAuth()
  const sessionQuery = useAuthSession(user?.uid ?? user?.email ?? null, Boolean(user))
  const { data: mySites = [] } = useMySites(Boolean(id))
  const memberSiteIds = useMemo(
    () => buildMemberSiteIdSet(mySites.map((site) => site.id)),
    [mySites],
  )

  const session = sessionQuery.data
  const access = getTransferAccess(transfer, memberSiteIds, {
    activeSiteId: session?.activeSiteId ?? null,
    currentUserId: session?.userId ?? user?.uid ?? null,
    activeRole: session?.activeRole ?? null,
  })

  return { access, memberSiteIds }
}

/** Display labels for catalog items and storage locations. */
export function useTransferLabels(locations: StorageLocation[]) {
  const { t } = useTranslation(['inventory'])
  const { data: inventoryResponse } = useInventory({ pageSize: 200 })

  const catalogLabelById = useMemo(() => {
    const map = new Map<string, { sku: string; name: string }>()
    for (const item of inventoryResponse?.data ?? []) {
      map.set(item.id, { sku: item.sku, name: item.name })
    }
    return map
  }, [inventoryResponse?.data])

  const locationLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const location of locations) {
      map.set(
        location.id,
        t('inventory:shared.locationCodeName', { code: location.code, name: location.name }),
      )
    }
    return map
  }, [locations, t])

  return { catalogLabelById, locationLabelById }
}

function lineSetter(update: Dispatch<SetStateAction<QtyByLine>>) {
  return (lineId: string, value: string) =>
    update((current) => ({ ...current, [lineId]: value }))
}

/** Per-line values the user typed or picked in the lines table. */
export function useTransferLineInputs() {
  const [receiveQtyByLine, setReceiveQtyByLine] = useState<QtyByLine>({})
  const [returnQtyByLine, setReturnQtyByLine] = useState<QtyByLine>({})
  const [destLocationByLine, setDestLocationByLine] = useState<QtyByLine>({})
  const [sourceLocationByLine, setSourceLocationByLine] = useState<QtyByLine>({})

  return {
    receiveQtyByLine,
    returnQtyByLine,
    destLocationByLine,
    sourceLocationByLine,
    setReceiveQty: lineSetter(setReceiveQtyByLine),
    setReturnQty: lineSetter(setReturnQtyByLine),
    setDestLocation: lineSetter(setDestLocationByLine),
    setSourceLocation: lineSetter(setSourceLocationByLine),
  }
}

export type TransferLineInputs = ReturnType<typeof useTransferLineInputs>

/** Approve, reject and cancel, with the optional reasons typed in the dialogs. */
export function useRequestActions(id: string) {
  const { t } = useTranslation(['inventory', 'common'])
  const approveMutation = useApproveStockTransfer(id)
  const rejectMutation = useRejectStockTransfer(id)
  const cancelMutation = useCancelStockTransfer(id)
  const [rejectReason, setRejectReason] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const failed = t('inventory:stockTransfers.detail.toast.actionFailed')

  return {
    rejectReason,
    setRejectReason,
    cancelReason,
    setCancelReason,
    approvePending: approveMutation.isPending,
    approve: (transfer: StockTransfer) =>
      runAction(t('inventory:stockTransfers.detail.toast.approved'), failed, () =>
        approveMutation.mutateAsync({ expectedVersion: transfer.version }),
      ),
    reject: (transfer: StockTransfer) =>
      runAction(t('inventory:stockTransfers.detail.toast.rejected'), failed, () =>
        rejectMutation.mutateAsync({
          expectedVersion: transfer.version,
          reason: rejectReason || undefined,
        }),
      ),
    cancel: (transfer: StockTransfer) =>
      runAction(t('inventory:stockTransfers.detail.toast.cancelled'), failed, () =>
        cancelMutation.mutateAsync({
          expectedVersion: transfer.version,
          reason: cancelReason || undefined,
        }),
      ),
  }
}

/** Ship, receive and return, validated against what the user entered per line. */
export function useFulfilmentActions(
  id: string,
  access: TransferAccess,
  inputs: TransferLineInputs,
) {
  const { t } = useTranslation(['inventory'])
  const shipMutation = useShipStockTransfer(id)
  const receiveMutation = useReceiveStockTransfer(id)
  const returnMutation = useReturnStockTransfer(id)
  const failed = t('inventory:stockTransfers.detail.toast.actionFailed')

  return {
    shipPending: shipMutation.isPending,
    receivePending: receiveMutation.isPending,
    returnPending: returnMutation.isPending,
    ship: (transfer: StockTransfer) => {
      if (!access.canShip) {
        toast.error(t('inventory:stockTransfers.detail.toast.switchSiteBeforeShip'))
        return
      }
      if (getLinesMissingShipSourceBins(transfer, inputs.sourceLocationByLine).length > 0) {
        toast.error(t('inventory:stockTransfers.detail.toast.selectSourceBins'))
        return
      }
      return runAction(t('inventory:stockTransfers.detail.toast.shipped'), failed, () =>
        shipMutation.mutateAsync({
          expectedVersion: transfer.version,
          lines: buildShipLines(transfer, inputs.sourceLocationByLine),
        }),
      )
    },
    receive: (transfer: StockTransfer) => {
      if (!access.canReceive) {
        toast.error(t('inventory:stockTransfers.detail.toast.switchSiteBeforeReceive'))
        return
      }
      const lines = buildReceiveLines(transfer, inputs.receiveQtyByLine, inputs.destLocationByLine)
      if (lines.length === 0) {
        toast.error(t('inventory:stockTransfers.detail.toast.enterReceiveQty'))
        return
      }
      return runAction(t('inventory:stockTransfers.detail.toast.received'), failed, () =>
        receiveMutation.mutateAsync({
          expectedVersion: transfer.version,
          idempotencyKey: generateId(),
          lines,
        }),
      )
    },
    returnUnreceived: (transfer: StockTransfer) => {
      const lines = buildReturnLines(transfer, inputs.returnQtyByLine)
      if (lines.length === 0) {
        toast.error(t('inventory:stockTransfers.detail.toast.enterReturnQty'))
        return
      }
      return runAction(t('inventory:stockTransfers.detail.toast.returned'), failed, () =>
        returnMutation.mutateAsync({
          expectedVersion: transfer.version,
          idempotencyKey: generateId(),
          lines,
        }),
      )
    },
  }
}
