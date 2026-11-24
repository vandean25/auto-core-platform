import type { CustomerActivityType } from '@/api/customers'

export type ActivityFilterChip = {
  key: 'orders' | 'invoices' | 'emails' | 'consents' | 'vehicleNotices' | 'loanerBookings' | 'audit'
  types: readonly CustomerActivityType[]
}

export const ACTIVITY_FILTER_CHIPS: readonly ActivityFilterChip[] = [
  { key: 'orders', types: ['workshop_order', 'sales_order'] },
  { key: 'invoices', types: ['invoice', 'credit_note'] },
  { key: 'emails', types: ['email'] },
  { key: 'consents', types: ['consent'] },
  { key: 'vehicleNotices', types: ['vehicle_notice'] },
  { key: 'loanerBookings', types: ['loaner_booking'] },
  { key: 'audit', types: ['audit'] },
] as const

export function parseActivityTypesParam(raw: string | null): CustomerActivityType[] {
  if (!raw) return []
  const valid = new Set<string>(ACTIVITY_FILTER_CHIPS.flatMap((chip) => chip.types))
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is CustomerActivityType => valid.has(value))
}

export function isChipSelected(
  chip: ActivityFilterChip,
  selectedTypes: readonly CustomerActivityType[],
): boolean {
  return chip.types.every((type) => selectedTypes.includes(type))
}

export function toggleActivityChip(
  chip: ActivityFilterChip,
  selectedTypes: readonly CustomerActivityType[],
): CustomerActivityType[] {
  const active = isChipSelected(chip, selectedTypes)
  const chipSet = new Set<CustomerActivityType>(chip.types)
  if (active) {
    return selectedTypes.filter((type) => !chipSet.has(type))
  }
  return [...new Set([...selectedTypes, ...chip.types])]
}

export function buildActivitySummaryParts(
  summary: Record<string, unknown>,
  formatAmount: (value: number) => string,
  formatTemplateId?: (templateId: string) => string,
): string[] {
  const parts: string[] = []
  const textKeys = ['vehicle', 'template_id', 'reason', 'actor_email'] as const
  for (const key of textKeys) {
    const val = summary[key]
    if (typeof val === 'string' && val.length > 0) {
      parts.push(key === 'template_id' && formatTemplateId ? formatTemplateId(val) : val)
    }
  }
  const amount =
    typeof summary.total_gross === 'number'
      ? summary.total_gross
      : typeof summary.total_amount === 'number'
        ? summary.total_amount
        : null
  if (amount !== null) {
    parts.push(formatAmount(amount))
  }
  return parts
}
