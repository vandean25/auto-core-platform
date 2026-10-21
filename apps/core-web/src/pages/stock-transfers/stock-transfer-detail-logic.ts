import type { components } from '@/api/generated/openapi'
import type { StockTransfer } from '@/api/stock-transfers'
import {
  canApproveOrRejectTransfer,
  canCancelTransfer,
  canReceiveTransfer,
  canReturnTransfer,
  canShipTransfer,
  hasReceiveMembership,
  hasShipMembership,
  resolveShipSourceLocationId,
} from './stock-transfer-permissions'

type TenantRole = components['schemas']['TenantMemberRole']

export interface TransferViewer {
  activeSiteId: string | null
  currentUserId: string | null
  activeRole: TenantRole | null
}

const NO_ACCESS = {
  canApprove: false,
  canCancel: false,
  canShip: false,
  canReceive: false,
  canReturn: false,
  showShipControls: false,
  showReceiveControls: false,
  needsFromSiteForShip: false,
  needsToSiteForReceive: false,
}

export type TransferAccess = typeof NO_ACCESS

/** What the viewer may do with the transfer; all false while it is not loaded. */
export function getTransferAccess(
  transfer: StockTransfer | undefined,
  memberSiteIds: Set<string>,
  viewer: TransferViewer,
): TransferAccess {
  if (!transfer) return NO_ACCESS

  const { activeSiteId, currentUserId, activeRole } = viewer
  const shipMember = hasShipMembership(transfer, memberSiteIds)
  const receiveMember = hasReceiveMembership(transfer, memberSiteIds)
  const canShip = canShipTransfer(transfer, memberSiteIds, activeSiteId)
  const canReceive = canReceiveTransfer(transfer, memberSiteIds, activeSiteId)

  return {
    canApprove: canApproveOrRejectTransfer(transfer, memberSiteIds, activeRole),
    canCancel: canCancelTransfer(transfer, memberSiteIds, currentUserId, activeRole),
    canShip,
    canReceive,
    canReturn: canReturnTransfer(transfer, memberSiteIds, activeRole),
    showShipControls: shipMember && canShip,
    showReceiveControls: receiveMember && canReceive,
    needsFromSiteForShip: shipMember && activeSiteId !== transfer.fromSiteId,
    needsToSiteForReceive: receiveMember && activeSiteId !== transfer.toSiteId,
  }
}

export function buildShipLines(
  transfer: StockTransfer,
  sourceLocationByLine: Record<string, string>,
) {
  return transfer.lines
    .filter((line) => Number(line.approvedQty) > 0)
    .map((line) => ({
      id: line.id,
      sourceLocationId: resolveShipSourceLocationId(line, sourceLocationByLine)!,
    }))
}

export function buildReceiveLines(
  transfer: StockTransfer,
  receiveQtyByLine: Record<string, string>,
  destLocationByLine: Record<string, string>,
) {
  return transfer.lines
    .map((line) => ({
      id: line.id,
      receiveQty: Number(receiveQtyByLine[line.id] ?? '0'),
      destLocationId: destLocationByLine[line.id] ?? line.destLocationId ?? '',
    }))
    .filter((line) => line.receiveQty && line.destLocationId)
}

export function buildReturnLines(
  transfer: StockTransfer,
  returnQtyByLine: Record<string, string>,
) {
  return transfer.lines
    .map((line) => ({ id: line.id, returnQty: Number(returnQtyByLine[line.id] ?? '0') }))
    .filter((line) => line.returnQty)
}
