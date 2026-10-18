import type { TFunction } from 'i18next'

export function creditLineQuantityAriaLabel(
  t: TFunction<'finance'>,
  description: string,
): string {
  return t('creditNotes.quantityInputAria', { description })
}
