export function canManageInventoryItems(activeRole: string | null | undefined): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}
