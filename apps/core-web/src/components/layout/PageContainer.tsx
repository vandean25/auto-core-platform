import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PageContainerProps = {
  children: ReactNode
  className?: string
}

/** Shared shell wrapper for admin routes — width from `--container-page` in index.css */
export function PageContainer({ children, className }: PageContainerProps) {
  return <div className={cn('w-full max-w-page mx-auto p-6', className)}>{children}</div>
}
