import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Loader2 } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
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
  /** Closed control. `field` matches a select; `badge` keeps the status chip. */
  appearance?: 'field' | 'badge'
  leading?: React.ReactNode
  badgeStatus?: string
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

function PickerTriggerButton({
  ariaLabel,
  busy,
  disabled,
  className,
  testId,
  onClick,
  children,
}: {
  ariaLabel: string
  busy: boolean
  disabled: boolean
  className?: string
  testId?: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {children}
    </button>
  )
}

function FieldPickerTrigger({
  label,
  ariaLabel,
  busy,
  disabled,
  leading,
  className,
  testId,
  onClick,
}: {
  label: string
  ariaLabel: string
  busy: boolean
  disabled: boolean
  leading?: React.ReactNode
  className?: string
  testId?: string
  onClick?: () => void
}) {
  return (
    <PickerTriggerButton
      ariaLabel={ariaLabel}
      busy={busy}
      disabled={disabled}
      testId={testId}
      onClick={onClick}
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm',
        'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50 max-md:h-11',
        className,
      )}
    >
      <span className="flex min-w-0 items-center">
        {leading}
        <span className="truncate">{label}</span>
      </span>
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      )}
    </PickerTriggerButton>
  )
}

function BadgePickerTrigger({
  label,
  ariaLabel,
  busy,
  disabled,
  badgeStatus,
  className,
  testId,
  onClick,
}: {
  label: string
  ariaLabel: string
  busy: boolean
  disabled: boolean
  badgeStatus: string
  className?: string
  testId?: string
  onClick?: () => void
}) {
  return (
    <PickerTriggerButton
      ariaLabel={ariaLabel}
      busy={busy}
      disabled={disabled}
      testId={testId}
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-md border-0 bg-transparent p-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11',
        className,
      )}
    >
      <StatusBadge status={badgeStatus} label={label} />
      {busy ? <Loader2 className="ml-1 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
    </PickerTriggerButton>
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

function closedPickerTrigger(props: {
  appearance: 'field' | 'badge'
  label: string
  ariaLabel: string
  busy: boolean
  disabled: boolean
  leading?: React.ReactNode
  badgeStatus: string
  className?: string
  testId?: string
  onClick?: () => void
}) {
  if (props.appearance === 'badge') {
    return <BadgePickerTrigger {...props} />
  }
  return <FieldPickerTrigger {...props} />
}

function pickerIsBusy(pending: boolean, saving: boolean) {
  return pending || saving
}

function pickerIsDisabled(disabled: boolean, pending: boolean, saving: boolean) {
  return disabled || pending || saving
}

function badgeStatusValue(badgeStatus: string | undefined, value?: string | null) {
  return badgeStatus ?? value ?? ''
}

function commandPickerView({
  props,
  isMobile,
  open,
  setOpen,
  saving,
  setSaving,
  searchLabel,
  emptyLabel,
}: {
  props: InlineEditCommandPickerProps
  isMobile: boolean
  open: boolean
  setOpen: (open: boolean) => void
  saving: boolean
  setSaving: (saving: boolean) => void
  searchLabel: string
  emptyLabel: string
}) {
  const {
    value,
    options,
    onSave,
    saveMode = 'server-confirmed',
    readOnly = false,
    pending = false,
    disabled = false,
    ariaLabel,
    emptyText,
    appearance = 'field',
    leading,
    badgeStatus,
    className,
    testId,
  } = props
  const label = options.find((option) => option.value === value)?.label ?? emptyText
  if (readOnly) {
    return <span className={cn('text-sm', className)}>{label}</span>
  }

  const close = () => setOpen(false)
  const panel = (
    <PickerOptions
      options={options}
      saving={saving}
      emptyLabel={emptyLabel}
      searchLabel={searchLabel}
      onSelect={(next) =>
        savePickerChoice({ next, value, options, saveMode, onSave, close, setSaving })
      }
      onCancel={close}
    />
  )
  const trigger = closedPickerTrigger({
    appearance,
    label,
    ariaLabel,
    busy: pickerIsBusy(pending, saving),
    disabled: pickerIsDisabled(disabled, pending, saving),
    leading,
    badgeStatus: badgeStatusValue(badgeStatus, value),
    className,
    testId,
    onClick: isMobile ? () => setOpen(true) : undefined,
  })
  const frame = { open, onOpenChange: setOpen, panel, trigger }
  if (isMobile) {
    return <MobileCommandPicker {...frame} ariaLabel={ariaLabel} searchLabel={searchLabel} />
  }
  return <DesktopCommandPicker {...frame} />
}

/** Searchable command picker for an inline choice. Mobile uses the bottom sheet; desktop uses a popover. */
export function InlineEditCommandPicker(props: InlineEditCommandPickerProps) {
  const { t } = useTranslation('common')
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  return commandPickerView({
    props,
    isMobile,
    open,
    setOpen,
    saving,
    setSaving,
    searchLabel: t('inlineEdit.search'),
    emptyLabel: t('inlineEdit.noMatches'),
  })
}
