import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type SettingsSectionHeadingProps = {
  title: ReactNode
  description?: ReactNode
  descriptionClassName?: string
  id?: string
  className?: string
}

export function SettingsSectionHeading({
  title,
  description,
  descriptionClassName = 'text-sm text-muted-foreground',
  id,
  className,
}: SettingsSectionHeadingProps) {
  return (
    <div className={className}>
      <h2 id={id} className="text-lg font-medium">
        {title}
      </h2>
      {description ? <p className={descriptionClassName}>{description}</p> : null}
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

type SettingsSubsectionIntroProps = {
  title: ReactNode
  description?: ReactNode
  descriptionClassName?: string
  id?: string
  headingClassName?: string
}

export function SettingsSubsectionIntro({
  title,
  description,
  descriptionClassName = 'text-sm text-muted-foreground',
  id,
  headingClassName,
}: SettingsSubsectionIntroProps) {
  return (
    <div>
      <SettingsSubsectionHeading title={title} id={id} className={headingClassName} />
      {description ? <p className={descriptionClassName}>{description}</p> : null}
    </div>
  )
}

