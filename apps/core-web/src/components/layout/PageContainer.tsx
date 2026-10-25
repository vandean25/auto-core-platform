import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs'
import type { BreadcrumbItem } from '@/components/navigation/Breadcrumbs'

type PageContainerProps = {
  children: ReactNode
  className?: string
  /** Trail above the page content. The last item is the current page. */
  breadcrumbs?: BreadcrumbItem[]
}

/** Shared shell wrapper for admin routes — width from `--container-page` in index.css */
export function PageContainer({ children, className, breadcrumbs }: PageContainerProps) {
  return (
    <div className={cn('w-full max-w-page mx-auto p-4 md:p-6', className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}
      {children}
    </div>
  )
}
