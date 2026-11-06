import type { ReactNode } from 'react'
import type { ColumnFiltersState } from '@tanstack/react-table'
import { AlertCircle, Clock3, Loader2Icon, SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { motionKindOf } from '@/lib/motion-tokens'

export type { DataTablePendingRowMeta } from './data-table-loading'
export { isDataTablePendingRow } from './data-table-loading'

export type DataTableEmptyState = { message: string; action?: ReactNode }

interface DataTableEmptyRowProps {
  colSpan: number
  fallbackMessage: string
  /** Shown only while no search or filter is active; a filtered-empty table says there are no results. */
  emptyState?: DataTableEmptyState
  columnFilters: ColumnFiltersState
  globalFilter?: string
}

export function DataTableEmptyRow({ colSpan, fallbackMessage, emptyState, columnFilters, globalFilter }: DataTableEmptyRowProps) {
  const isFiltered = columnFilters.length > 0 || Boolean(globalFilter)
  const shown = isFiltered ? undefined : emptyState

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0">
        <Empty className="border-0 py-10 md:py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{shown?.message ?? fallbackMessage}</EmptyTitle>
          </EmptyHeader>
          {shown?.action ? <EmptyContent>{shown.action}</EmptyContent> : null}
        </Empty>
      </TableCell>
    </TableRow>
  )
}

type DataTableStaleStatusProps = {
  visible: boolean
  className?: string
}

/** Textual stale/loading status for assistive tech and sighted users during a stale preview. */
export function DataTableStaleStatus({ visible, className }: DataTableStaleStatusProps) {
  const { t } = useTranslation('common')
  if (!visible) return null
  return (
    <p className={cn('text-xs text-muted-foreground', className)} role="status">
      {t('dataTable.loading.stalePreview')}
    </p>
  )
}

type DataTableRefreshIndicatorProps = {
  visible: boolean
}

export function DataTableRefreshIndicator({ visible }: DataTableRefreshIndicatorProps) {
  const { t } = useTranslation('common')
  if (!visible) return null
  return (
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground motion-reduce:transition-none"
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-3.5" />
      <span>{t('dataTable.loading.refreshing')}</span>
    </div>
  )
}

type DataTableFetchErrorProps = {
  message: string
  onRetry: () => void
}

/** Inline fetch error with retry, rendered outside the non-actionable preview region. */
export function DataTableFetchError({ message, onRetry }: DataTableFetchErrorProps) {
  const { t } = useTranslation('common')
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      <Button type="button" variant="outline" size="sm" className="max-md:min-h-11" onClick={onRetry}>
        {t('dataTable.loading.retry')}
      </Button>
    </div>
  )
}

type DataTablePendingIconProps = {
  label: string
}

export function DataTablePendingIcon({ label }: DataTablePendingIconProps) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Clock3 className="size-4 motion-reduce:animate-none" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

type InteractionErrorMarkerProps = {
  message: string
  onRetry?: () => void
  onDismiss?: () => void
  className?: string
}

/** Visible, non-color-only error marker until retry, edit or dismiss (ADR-0036 R1). */
export function InteractionErrorMarker({ message, onRetry, onDismiss, className }: InteractionErrorMarkerProps) {
  const { t } = useTranslation('common')
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-sm text-destructive',
        className,
      )}
    >
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onRetry}>
          {t('dataTable.loading.retry')}
        </Button>
      ) : null}
      {onDismiss ? (
        <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={onDismiss}>
          {t('dataTable.loading.dismiss')}
        </Button>
      ) : null}
    </div>
  )
}

type SubmitButtonPendingProps = {
  pending: boolean
  label: string
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: () => void
  className?: string
}

/** Keeps the label visible, blocks duplicate submit, leaves the rest of the page usable. */
export function SubmitButtonPending({
  pending,
  label,
  type = 'button',
  disabled,
  onClick,
  className,
}: SubmitButtonPendingProps) {
  return (
    <Button type={type} disabled={disabled || pending} aria-busy={pending} onClick={onClick} className={className}>
      {pending ? (
        <Loader2Icon
          aria-hidden="true"
          data-motion-kind={motionKindOf('spinner')}
          className="mr-2 size-4 animate-spin motion-reduce:animate-none"
        />
      ) : null}
      {label}
    </Button>
  )
}
