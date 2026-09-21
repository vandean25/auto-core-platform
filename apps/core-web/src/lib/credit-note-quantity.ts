import type { components } from '@/api/generated/openapi'

type TenantMemberRole = components['schemas']['TenantMemberRole']

export function parseCreditQuantity(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) return null

  return parsed
}

export function validateCreditQuantity(
  value: string,
  remainingQuantity?: string,
): string | null {
  const parsed = parseCreditQuantity(value)
  if (parsed === null) {
    return 'Enter a valid quantity greater than zero.'
  }

  if (remainingQuantity) {
    const remaining = Number(remainingQuantity)
    if (Number.isFinite(remaining) && parsed > remaining) {
      return `Cannot exceed remaining quantity (${remainingQuantity}).`
    }
  }

  return null
}

export function canManageCreditNotes(
  activeRole?: TenantMemberRole | null,
): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}
