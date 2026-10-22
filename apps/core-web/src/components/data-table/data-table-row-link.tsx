import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type DataTableRowDetailLinkProps = {
  href: string
  accessibleName: string
  children: ReactNode
  className?: string
  tabIndex?: number
}

export function DataTableRowDetailLink({
  href,
  accessibleName,
  children,
  className,
  tabIndex,
}: DataTableRowDetailLinkProps) {
  return (
    <Link
      to={href}
      tabIndex={tabIndex}
      aria-label={accessibleName}
      className={cn(
        'inline-flex min-h-6 items-center rounded-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      {children}
    </Link>
  )
}

export function isDataTableRowLinkColumn(columnDef: { meta?: unknown }): boolean {
  const meta = columnDef.meta as { rowLink?: boolean } | undefined
  return meta?.rowLink === true
}
