import { formatCurrency, formatHours } from '@/lib/format'

/** Screen matchers for amounts rendered through `formatCurrency` (de-AT). */
export function formattedCurrency(amount: number | string): string {
  return formatCurrency(amount)
}

export function formattedCurrencyPattern(amount: number | string): RegExp {
  const text = formattedCurrency(amount)
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\u00a0/g, '\\s')
  return new RegExp(escaped)
}

export function formattedHours(value: number, suffix = ' h'): string {
  return formatHours(value, suffix)
}

export function formattedCurrencyLabelPattern(amount: number | string, label: string): RegExp {
  const amountPart = formattedCurrency(amount)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\u00a0/g, '\\s*')
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${amountPart}\\s*\\(${escapedLabel}\\)`)
}
