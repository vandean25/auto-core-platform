import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type SettingsSectionHeadingProps = {
  title: string
  description?: string
  id?: string
  className?: string
}

export function SettingsSectionHeading({
  title,
  description,
  id,
  className,
}: SettingsSectionHeadingProps) {
  return (
    <div className={className}>
      <h2 id={id} className="text-lg font-medium">
        {title}
      </h2>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}

type SettingsSubsectionHeadingProps = {
  title: ReactNode
  id?: string
  className?: string
}

export function SettingsSubsectionHeading({
  title,
  id,
  className,
}: SettingsSubsectionHeadingProps) {
  return (
    <h3 id={id} className={cn('font-medium', className)}>
      {title}
    </h3>
  )
}
