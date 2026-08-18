import type { PartRequestForm } from './types'

export function validatePartRequest(form: PartRequestForm): string | null {
  const qty = parseFloat(form.qty)
  if (!form.itemNo.trim()) {
    return 'Part number is required.'
  }
  if (!form.description.trim()) {
    return 'Description is required.'
  }
  if (!Number.isFinite(qty) || qty < 0.01) {
    return 'Quantity must be at least 0.01.'
  }
  return null
}
