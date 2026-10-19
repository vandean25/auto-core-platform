import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { creditLineQuantityAriaLabel } from '@/lib/credit-note-quantity-a11y'

type CreditNoteLineQuantityInputProps = Omit<
  ComponentProps<typeof Input>,
  'aria-label'
> & {
  description: string
}

export function CreditNoteLineQuantityInput({
  description,
  id,
  ...props
}: CreditNoteLineQuantityInputProps) {
  const { t } = useTranslation('finance')

  return (
    <Input
      id={id}
      aria-label={creditLineQuantityAriaLabel(t, description)}
      {...props}
    />
  )
}
