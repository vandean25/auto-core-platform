export type CheckInOfflineScope = {
  userId: string
  tenantId: string
  siteId: string
  orderId: string
  checkInId: string
}

export function buildCheckInOfflineScopeKey(scope: CheckInOfflineScope): string {
  return [
    scope.userId,
    scope.tenantId,
    scope.siteId,
    scope.orderId,
    scope.checkInId,
  ].join('/')
}

export function scopesMatch(
  left: CheckInOfflineScope | null | undefined,
  right: CheckInOfflineScope | null | undefined,
): boolean {
  if (!left || !right) {
    return false
  }
  return buildCheckInOfflineScopeKey(left) === buildCheckInOfflineScopeKey(right)
}
