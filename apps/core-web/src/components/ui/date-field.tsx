import * as React from 'react'
import { format, isValid, parse, parseISO } from 'date-fns'
import { deAT } from 'date-fns/locale/de-AT'
import { CalendarIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const DISPLAY_FORMAT = 'dd.MM.yyyy'
const ISO_FORMAT = 'yyyy-MM-dd'

function toDisplay(iso: string): string {
  const date = iso ? parseISO(iso) : null
  return date && isValid(date) ? format(date, DISPLAY_FORMAT) : ''
}

/** Parses a typed `TT.MM.JJJJ` date to ISO; `null` while the text is not a real calendar date. */
export function parseDisplayDate(text: string): string | null {
  const date = parse(text, DISPLAY_FORMAT, new Date())
  return isValid(date) && format(date, DISPLAY_FORMAT) === text ? format(date, ISO_FORMAT) : null
}

interface DateFieldProps {
  /** ISO `yyyy-MM-dd`, or an empty string for no date. */
  value: string
  onChange: (iso: string) => void
  id?: string
  className?: string
  disabled?: boolean
  'aria-label'?: string
  'data-testid'?: string
}

/** Date input that always shows `TT.MM.JJJJ`, whatever the browser locale (native `type="date"` follows it). */
export function DateField({
  value,
  onChange,
  id,
  className,
  disabled,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: DateFieldProps) {
  const { t } = useTranslation('common')
  const [draft, setDraft] = React.useState(() => toDisplay(value))

  React.useEffect(() => {
    setDraft((current) => (parseDisplayDate(current) === value ? current : toDisplay(value)))
  }, [value])

  const handleChange = (text: string) => {
    setDraft(text)
    if (text === '') onChange('')
    else {
      const iso = parseDisplayDate(text)
      if (iso) onChange(iso)
    }
  }

  const selected = value ? parseISO(value) : undefined

  return (
    <div className="flex items-center gap-1">
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={t('dateField.placeholder')}
        maxLength={10}
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
        className={className}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={() => setDraft(toDisplay(value))}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            aria-label={t('dateField.openCalendar')}
            className="shrink-0 max-sm:min-h-11 max-sm:min-w-11"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            locale={deAT}
            selected={selected && isValid(selected) ? selected : undefined}
            defaultMonth={selected && isValid(selected) ? selected : undefined}
            onSelect={(date) => {
              const iso = date ? format(date, ISO_FORMAT) : ''
              setDraft(toDisplay(iso))
              onChange(iso)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
