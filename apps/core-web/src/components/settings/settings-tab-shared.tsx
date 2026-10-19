import type { ReactNode } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

import { SettingsSectionHeading } from '@/components/settings/SettingsSectionHeading'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-utils'

export async function commitSettingsTabMutation<T, P>({
  mutateAsync,
  payload,
  onSaved,
  successMessage,
  failureMessage,
}: {
  mutateAsync: (payload: P) => Promise<T>
  payload: P
  onSaved: (value: T) => void
  successMessage: string
  failureMessage: string
}) {
  await persistSettingsUpdate({
    save: () => mutateAsync(payload),
    onSaved,
    successMessage,
    failureMessage,
  })
}

export async function persistSettingsUpdate<T>({
  save,
  onSaved,
  successMessage,
  failureMessage,
}: {
  save: () => Promise<T>
  onSaved: (value: T) => void
  successMessage: string
  failureMessage: string
}) {
  try {
    const saved = await save()
    onSaved(saved)
    toast.success(successMessage)
  } catch (error: unknown) {
    toast.error(getErrorMessage(error, failureMessage))
  }
}

export function SettingsTabLoadingState({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-12', className)}>
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

type SettingsTabPanelProps = {
  title?: ReactNode
  description?: ReactNode
  descriptionClassName?: string
  headerActions?: ReactNode
  density?: 'default' | 'compact'
  children: ReactNode
  className?: string
}

export function SettingsTabPanel({
  title,
  description,
  descriptionClassName,
  headerActions,
  density = 'default',
  children,
  className,
}: SettingsTabPanelProps) {
  const heading =
    title ? (
      <SettingsSectionHeading
        title={title}
        description={description}
        descriptionClassName={descriptionClassName}
      />
    ) : null

  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-6 shadow-sm',
        density === 'compact' ? 'space-y-4' : 'space-y-6',
        className,
      )}
    >
      {heading && headerActions ? (
        <div className="flex items-center justify-between gap-4">
          {heading}
          {headerActions}
        </div>
      ) : (
        heading
      )}
      {children}
    </div>
  )
}

export function SettingsSubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  )
}

export function SettingsSubmitRow({ pending, label }: { pending: boolean; label: string }) {
  return (
    <div className="flex justify-end">
      <SettingsSubmitButton pending={pending} label={label} />
    </div>
  )
}

type SettingsIconActionButtonProps = {
  pending: boolean
  idleIcon: ReactNode
  label: string
  type?: 'button' | 'submit'
  variant?: 'default' | 'outline' | 'secondary'
  disabled?: boolean
  onClick?: () => void
}

export function SettingsIconActionButton({
  pending,
  idleIcon,
  label,
  type = 'button',
  variant = 'default',
  disabled,
  onClick,
}: SettingsIconActionButtonProps) {
  return (
    <Button type={type} variant={variant} disabled={disabled || pending} onClick={onClick}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : idleIcon}
      {label}
    </Button>
  )
}
