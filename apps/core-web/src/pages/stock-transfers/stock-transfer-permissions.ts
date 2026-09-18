import type { components } from '@/api/generated/openapi'
import type { StockTransfer } from '@/api/stock-transfers'

type TenantRole = components['schemas']['TenantMemberRole']

export function buildMemberSiteIdSet(siteIds: string[] | undefined) {
  return new Set(siteIds ?? [])
}

export function hasSiteMembership(siteId: string, memberSiteIds: Set<string>) {
  return memberSiteIds.has(siteId)
}

export function canCreateTransfer(memberSiteIds: Set<string>) {
  return memberSiteIds.size > 0
}

export function canSuggestSourceBin(fromSiteId: string, memberSiteIds: Set<string>) {
  return hasSiteMembership(fromSiteId, memberSiteIds)
}

export function canCancelTransfer(transfer: StockTransfer, memberSiteIds: Set<string>) {
  if (transfer.status !== 'REQUESTED' && transfer.status !== 'APPROVED') return false
  return (
    hasSiteMembership(transfer.fromSiteId, memberSiteIds) ||
    hasSiteMembership(transfer.toSiteId, memberSiteIds)
  )
}

export function canApproveOrRejectTransfer(
  transfer: StockTransfer,
  memberSiteIds: Set<string>,
  activeRole: TenantRole | null,
) {
  if (transfer.status !== 'REQUESTED') return false
  const isAdmin = activeRole === 'OWNER' || activeRole === 'ADMIN'
  return isAdmin && hasSiteMembership(transfer.fromSiteId, memberSiteIds)
}

export function canShipTransfer(transfer: StockTransfer, memberSiteIds: Set<string>) {
  if (transfer.status !== 'APPROVED') return false
  return hasSiteMembership(transfer.fromSiteId, memberSiteIds)
}

export function canReceiveTransfer(transfer: StockTransfer, memberSiteIds: Set<string>) {
  if (transfer.status !== 'SHIPPED') return false
  return hasSiteMembership(transfer.toSiteId, memberSiteIds)
}

export function canReturnTransfer(
  transfer: StockTransfer,
  memberSiteIds: Set<string>,
  activeRole: TenantRole | null,
) {
  if (transfer.status !== 'SHIPPED') return false
  const isFromAdmin =
    (activeRole === 'OWNER' || activeRole === 'ADMIN') &&
    hasSiteMembership(transfer.fromSiteId, memberSiteIds)
  return hasSiteMembership(transfer.toSiteId, memberSiteIds) || isFromAdmin
}

export function shouldShowSourceBinDetails(
  fromSiteId: string,
  memberSiteIds: Set<string>,
  sourceLocationId: string | null | undefined,
) {
  return Boolean(sourceLocationId) && hasSiteMembership(fromSiteId, memberSiteIds)
}
