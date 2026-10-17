import type { PartRequestForm } from './types'

export type PartRequestValidationError =
  | 'itemNoRequired'
  | 'descriptionRequired'
  | 'quantityMin'

export function validatePartRequest(form: PartRequestForm): PartRequestValidationError | null {
  const qty = parseFloat(form.qty)
  if (!form.itemNo.trim()) {
    return 'itemNoRequired'
  }
  if (!form.description.trim()) {
    return 'descriptionRequired'
  }
  if (!Number.isFinite(qty) || qty < 0.01) {
    return 'quantityMin'
  }
  return null
}
