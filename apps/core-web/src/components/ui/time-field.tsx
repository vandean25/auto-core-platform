import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** True for a 24-hour `HH:mm` time. */
export function isValidTime(text: string): boolean {
  return TIME_PATTERN.test(text)
}

/** Inserts the colon while digits are typed, so a numeric keypad without a ":" key still works. */
export function autoColonTime(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 4)
  return digits.length > 2 || (digits.length === 2 && text.includes(':')) ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits
}

/** True when the user only removed characters from the end (backspace), so the text must not be re-formatted. */
function isDeletion(next: string, previous: string): boolean {
  return next.length < previous.length && previous.startsWith(next)
}

interface TimeFieldProps {
  /** `HH:mm` (24-hour), or an empty string for no time. */
  value: string
  onChange: (time: string) => void
  id?: string
  className?: string
  disabled?: boolean
  required?: boolean
  'aria-label'?: string
}

/** 24-hour time input that always shows `HH:mm`, whatever the browser locale (native `type="time"` follows it, e.g. "07:30 AM"). */
export function TimeField({
  value,
  onChange,
  id,
  className,
  disabled,
  required,
  'aria-label': ariaLabel,
}: TimeFieldProps) {
  const { t } = useTranslation('common')
  const [draft, setDraft] = React.useState(value)

  React.useEffect(() => {
    setDraft((current) => (isValidTime(current) && current === value ? current : value))
  }, [value])

  const handleChange = (rawText: string) => {
    const text = isDeletion(rawText, draft) ? rawText : autoColonTime(rawText)
    setDraft(text)
    if (text === '') onChange('')
    else if (isValidTime(text)) onChange(text)
  }

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={t('timeField.placeholder')}
      maxLength={5}
      value={draft}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      aria-invalid={draft !== '' && !isValidTime(draft) ? true : undefined}
      className={cn('max-sm:min-h-11 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive', className)}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={() => setDraft(value)}
    />
  )
}
