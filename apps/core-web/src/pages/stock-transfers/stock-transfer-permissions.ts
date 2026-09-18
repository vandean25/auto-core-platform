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

export function canCancelTransfer(
  transfer: StockTransfer,
  memberSiteIds: Set<string>,
  currentUserId: string | null,
  activeRole: TenantRole | null,
) {
  if (transfer.status !== 'REQUESTED' && transfer.status !== 'APPROVED') return false
  if (currentUserId && transfer.requestedByUserId === currentUserId) return true
  const isAdmin = activeRole === 'OWNER' || activeRole === 'ADMIN'
  return isAdmin && hasSiteMembership(transfer.fromSiteId, memberSiteIds)
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

export function canShipTransfer(
  transfer: StockTransfer,
  memberSiteIds: Set<string>,
  activeSiteId: string | null,
) {
  if (transfer.status !== 'APPROVED') return false
  if (!hasSiteMembership(transfer.fromSiteId, memberSiteIds)) return false
  return activeSiteId === transfer.fromSiteId
}

export function hasShipMembership(
  transfer: StockTransfer,
  memberSiteIds: Set<string>,
) {
  return transfer.status === 'APPROVED' && hasSiteMembership(transfer.fromSiteId, memberSiteIds)
}

export function canReceiveTransfer(
  transfer: StockTransfer,
  memberSiteIds: Set<string>,
  activeSiteId: string | null,
) {
  if (transfer.status !== 'SHIPPED') return false
  if (!hasSiteMembership(transfer.toSiteId, memberSiteIds)) return false
  return activeSiteId === transfer.toSiteId
}

export function hasReceiveMembership(
  transfer: StockTransfer,
  memberSiteIds: Set<string>,
) {
  return transfer.status === 'SHIPPED' && hasSiteMembership(transfer.toSiteId, memberSiteIds)
}

export function resolveShipSourceLocationId(
  line: StockTransfer['lines'][number],
  sourceLocationByLine: Record<string, string>,
) {
  return sourceLocationByLine[line.id] ?? line.sourceLocationId ?? null
}

export function getLinesMissingShipSourceBins(
  transfer: StockTransfer,
  sourceLocationByLine: Record<string, string>,
) {
  return transfer.lines.filter((line) => {
    if (Number(line.approvedQty) <= 0) return false
    return !resolveShipSourceLocationId(line, sourceLocationByLine)
  })
}

export function canSubmitShip(
  transfer: StockTransfer,
  sourceLocationByLine: Record<string, string>,
) {
  const shippableLines = transfer.lines.filter((line) => Number(line.approvedQty) > 0)
  if (shippableLines.length === 0) return false
  return getLinesMissingShipSourceBins(transfer, sourceLocationByLine).length === 0
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
