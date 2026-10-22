import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  /** Trail above the title, e.g. a `Breadcrumbs` element. */
  breadcrumbs?: ReactNode
  /** Left of the title, e.g. a back button. */
  leading?: ReactNode
  /** Page-level buttons, top right. They wrap below the title on narrow screens. */
  actions?: ReactNode
  /** Optional row under the title, e.g. tabs or filters. */
  children?: ReactNode
  className?: string
}

export function PageHeader({ title, description, breadcrumbs, leading, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-8 flex flex-col gap-4', className)}>
      {breadcrumbs}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {leading}
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
      </div>
      {children}
    </header>
  )
}
