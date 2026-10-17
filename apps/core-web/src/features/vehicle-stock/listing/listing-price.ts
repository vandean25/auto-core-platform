export type ParsedListingPrice = { valid: boolean; value: number | null }

/** Parses gross price as `1250`, `1250.5`, `1.250,50` or `1250,50`. Blank input clears the price. */
export function parseListingGrossPrice(raw: string): ParsedListingPrice {
  const cleaned = raw.trim().replace(/\s/g, '')
  if (cleaned === '') return { valid: true, value: null }

  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return { valid: false, value: null }

  const value = Number(normalized)
  if (value > 9_999_999_999.99) return { valid: false, value: null }
  return { valid: true, value }
}
