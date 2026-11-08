import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

const OPTION_ROW_MIN_HEIGHT_PX = 44

export type InlineEditPickerOption = {
  value: string
  label: string
}

type InlineEditCommandPickerProps = {
  value?: string | null
  options: InlineEditPickerOption[]
  onSave: (nextValue: string) => Promise<void> | void
  /** Optimistic closes before the server answers. Server-confirmed keeps the picker until the save settles. */
  saveMode?: 'optimistic' | 'server-confirmed'
  readOnly?: boolean
  /** Disables the trigger while a server-confirmed save is still in flight. */
  pending?: boolean
  disabled?: boolean
  ariaLabel: string
  emptyText: string
  className?: string
  testId?: string
}

function matchesSearch(itemValue: string, search: string, keywords: string[] = []) {
  const haystack = [itemValue, ...keywords].join(' ').toLowerCase()
  return haystack.includes(search.trim().toLowerCase()) ? 1 : 0
}

function PickerOptions({
  options,
  saving,
  emptyLabel,
  searchLabel,
  onSelect,
  onCancel,
}: {
  options: InlineEditPickerOption[]
  saving: boolean
  emptyLabel: string
  searchLabel: string
  onSelect: (value: string) => void
  onCancel: () => void
}) {
  return (
    <Command filter={matchesSearch}>
      <CommandInput
        aria-label={searchLabel}
        placeholder={searchLabel}
        disabled={saving}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onCancel()
        }}
      />
      <CommandList>
        <CommandEmpty>{emptyLabel}</CommandEmpty>
        <CommandGroup>
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={option.value}
              keywords={[option.label]}
              disabled={saving}
              style={{ minHeight: OPTION_ROW_MIN_HEIGHT_PX }}
              className="min-h-11"
              onSelect={() => onSelect(option.value)}
            >
              {option.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function PickerTrigger({
  label,
  ariaLabel,
  busy,
  disabled,
  className,
  testId,
  onClick,
}: {
  label: string
  ariaLabel: string
  busy: boolean
  disabled: boolean
  className?: string
  testId?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
    </button>
  )
}

function savePickerChoice({
  next,
  value,
  options,
  saveMode,
  onSave,
  close,
  setSaving,
}: {
  next: string
  value?: string | null
  options: InlineEditPickerOption[]
  saveMode: 'optimistic' | 'server-confirmed'
  onSave: (nextValue: string) => Promise<void> | void
  close: () => void
  setSaving: (saving: boolean) => void
}) {
  const option = options.find((candidate) => candidate.value.toLowerCase() === next.toLowerCase())
  if (!option || option.value === (value ?? '')) {
    if (option) close()
    return
  }
  if (saveMode === 'optimistic') {
    close()
    void Promise.resolve(onSave(option.value)).catch(() => undefined)
    return
  }
  setSaving(true)
  void Promise.resolve(onSave(option.value))
    .then(() => close())
    .catch(() => undefined)
    .finally(() => setSaving(false))
}

function MobileCommandPicker({
  open,
  onOpenChange,
  ariaLabel,
  searchLabel,
  panel,
  trigger,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ariaLabel: string
  searchLabel: string
  panel: React.ReactNode
  trigger: React.ReactNode
}) {
  return (
    <>
      {trigger}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" data-side="bottom" className="px-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{ariaLabel}</SheetTitle>
            <SheetDescription>{searchLabel}</SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    </>
  )
}

function DesktopCommandPicker({
  open,
  onOpenChange,
  panel,
  trigger,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  panel: React.ReactNode
  trigger: React.ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {panel}
      </PopoverContent>
    </Popover>
  )
}

/** Searchable command picker for an inline choice. Mobile uses the bottom sheet; desktop uses a popover. */
export function InlineEditCommandPicker({
  value,
  options,
  onSave,
  saveMode = 'server-confirmed',
  readOnly = false,
  pending = false,
  disabled = false,
  ariaLabel,
  emptyText,
  className,
  testId,
}: InlineEditCommandPickerProps) {
  const { t } = useTranslation('common')
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const label = options.find((option) => option.value === value)?.label ?? emptyText
  const searchLabel = t('inlineEdit.search')
  const emptyLabel = t('inlineEdit.noMatches')

  if (readOnly) {
    return <span className={cn('text-sm', className)}>{label}</span>
  }

  const panel = (
    <PickerOptions
      options={options}
      saving={saving}
      emptyLabel={emptyLabel}
      searchLabel={searchLabel}
      onSelect={(next) =>
        savePickerChoice({
          next,
          value,
          options,
          saveMode,
          onSave,
          close: () => setOpen(false),
          setSaving,
        })
      }
      onCancel={() => setOpen(false)}
    />
  )
  const trigger = (
    <PickerTrigger
      label={label}
      ariaLabel={ariaLabel}
      busy={pending || saving}
      disabled={disabled || pending || saving}
      className={className}
      testId={testId}
      onClick={isMobile ? () => setOpen(true) : undefined}
    />
  )
  const frame = { open, onOpenChange: setOpen, panel, trigger }

  if (isMobile) {
    return <MobileCommandPicker {...frame} ariaLabel={ariaLabel} searchLabel={searchLabel} />
  }

  return <DesktopCommandPicker {...frame} />
}
