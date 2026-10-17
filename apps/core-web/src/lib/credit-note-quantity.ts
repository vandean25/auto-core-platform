import type { components } from '@/api/generated/openapi'

type TenantMemberRole = components['schemas']['TenantMemberRole']

export type CreditQuantityValidation =
  | { key: 'creditNotes.validation.invalidQuantity' }
  | { key: 'creditNotes.validation.exceedsRemaining'; params: { remaining: string } }

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
): CreditQuantityValidation | null {
  const parsed = parseCreditQuantity(value)
  if (parsed === null) {
    return { key: 'creditNotes.validation.invalidQuantity' }
  }

  if (remainingQuantity) {
    const remaining = Number(remainingQuantity)
    if (Number.isFinite(remaining) && parsed > remaining) {
      return {
        key: 'creditNotes.validation.exceedsRemaining',
        params: { remaining: remainingQuantity },
      }
    }
  }

  return null
}

export function canManageCreditNotes(
  activeRole?: TenantMemberRole | null,
): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}
