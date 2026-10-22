import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'
import { useDelayedFlag } from '@/hooks/useDelayedFlag'

// Skeletons appear only after `delayMs`, so mounting one while data loads never flashes on a fast response.
const SKELETON_DELAY_MS = 200

/** Placeholder body rows for a table. Render inside a `TableBody` while loading. */
export function TableSkeleton({ rows = 5, cols, delayMs = SKELETON_DELAY_MS }: { rows?: number; cols: number; delayMs?: number }) {
  const { t } = useTranslation('common')
  const visible = useDelayedFlag(true, delayMs)
  if (!visible) return null

  return Array.from({ length: rows }, (_, rowIndex) => (
    <TableRow key={rowIndex} className="hover:bg-transparent">
      {Array.from({ length: cols }, (_, colIndex) => (
        <TableCell key={colIndex}>
          {rowIndex === 0 && colIndex === 0 ? (
            <span role="status" className="sr-only">
              {t('shell.loading')}
            </span>
          ) : null}
          <Skeleton className="h-4 w-full max-w-40" />
        </TableCell>
      ))}
    </TableRow>
  ))
}

export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-5 w-1/3" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  )
}

/** Page header block plus a card grid, shaped like a detail page. */
export function DetailSkeleton({ label, delayMs = SKELETON_DELAY_MS }: { label?: string; delayMs?: number }) {
  const { t } = useTranslation('common')
  const visible = useDelayedFlag(true, delayMs)
  if (!visible) return null

  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">{label ?? t('shell.loading')}</span>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton lines={6} className="lg:col-span-2" />
      </div>
    </div>
  )
}
