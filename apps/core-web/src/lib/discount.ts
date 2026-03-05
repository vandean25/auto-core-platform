import type { DiscountType } from '@/api/types'

export function parseDiscountValue(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function calculateDiscountAmount(
  baseAmount: number,
  discountType: DiscountType | null | undefined,
  discountValue: number | null,
) {
  const base = Math.max(0, baseAmount)
  if (!discountType || discountValue === null || discountValue <= 0) return 0
  if (discountType === 'PERCENTAGE') {
    return Math.min(base, (base * discountValue) / 100)
  }
  return Math.min(base, discountValue)
}
