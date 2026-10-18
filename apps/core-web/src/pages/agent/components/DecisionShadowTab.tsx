import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { Inbox, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDecisionShadowLogs } from '@/api/decision-shadow-logs'
import { formatDateTime } from '@/lib/format'
import type {
  DecisionShadowLog,
  DecisionShadowUseCase,
} from '@/api/decision-shadow-logs'
import { toLocalEndOfDayIso, toLocalStartOfDayIso } from './ActivityTab'

const USE_CASE_OPTIONS: DecisionShadowUseCase[] = [
  'import_row_matching',
  'document_sort',
]

/** Read-only shadow log view. It has filters and paging only; nothing here applies a suggestion. */
export function DecisionShadowTab() {
  const [useCaseFilter, setUseCaseFilter] = useState<
    'ALL' | DecisionShadowUseCase
  >('ALL')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const { t } = useTranslation('agent')

  useEffect(() => { void ensureNamespaceLoaded('agent') }, [])


  const {
    data: logsData,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDecisionShadowLogs({
    useCase: useCaseFilter === 'ALL' ? undefined : useCaseFilter,
    startDate: startDate ? toLocalStartOfDayIso(startDate) : undefined,
    endDate: endDate ? toLocalEndOfDayIso(endDate) : undefined,
    limit: 50,
  })

  const rows = logsData?.pages.flatMap((page) => page.data) ?? []

  return (
    <div className="space-y-6" data-testid="decision-shadow-tab">
      <p className="text-sm text-slate-500">
        {t('decisionShadow.description')}
      </p>

      {/* Filter toolbar: filters apply on change, so there is no Apply button */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="decision-shadow-use-case-select"
              className="text-xs text-slate-500 font-medium"
            >
              {t('decisionShadow.filters.useCaseLabel')}:
            </label>
            <select
              id="decision-shadow-use-case-select"
              value={useCaseFilter}
              onChange={(e) =>
                setUseCaseFilter(e.target.value as 'ALL' | DecisionShadowUseCase)
              }
              className="h-9 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm focus:border-slate-500 focus:outline-none"
              data-testid="filter-decision-shadow-use-case-select"
            >
              <option value="ALL">
                {t('decisionShadow.filters.allUseCases')}
              </option>
              {USE_CASE_OPTIONS.map((useCase) => (
                <option key={useCase} value={useCase}>
                  {t(`decisionShadow.useCases.${useCase}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label
              htmlFor="decision-shadow-start-date"
              className="text-xs text-slate-500 font-medium"
            >
              {t('activity.filters.startDateLabel')}:
            </label>
            <Input
              id="decision-shadow-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 w-36 text-xs"
              data-testid="filter-decision-shadow-start-date-input"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label
              htmlFor="decision-shadow-end-date"
              className="text-xs text-slate-500 font-medium"
            >
              {t('activity.filters.endDateLabel')}:
            </label>
            <Input
              id="decision-shadow-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 w-36 text-xs"
              data-testid="filter-decision-shadow-end-date-input"
            />
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          className="text-slate-500 hover:text-slate-900"
          aria-label={t('common.refresh')}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          <RefreshCw
            className="mx-auto mb-3 h-6 w-6 animate-spin text-slate-400"
            aria-hidden="true"
          />
          {t('common.loading')}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="text-sm font-medium text-rose-800">
            {t('common.error')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="mt-3 border-rose-300 text-rose-700 hover:bg-rose-100"
          >
            {t('common.retry')}
          </Button>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div
          className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center"
          data-testid="decision-shadow-empty-state"
        >
          <Inbox
            className="mx-auto mb-3 h-10 w-10 text-slate-400"
            aria-hidden="true"
          />
          <h3 className="text-base font-semibold text-slate-800">
            {t('decisionShadow.emptyState')}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {t('decisionShadow.emptyStateDesc')}
          </p>
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table data-testid="decision-shadow-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('decisionShadow.columns.time')}</TableHead>
                  <TableHead>{t('decisionShadow.columns.useCase')}</TableHead>
                  <TableHead>{t('decisionShadow.columns.suggestion')}</TableHead>
                  <TableHead>
                    {t('decisionShadow.columns.actualOutcome')}
                  </TableHead>
                  <TableHead>{t('decisionShadow.columns.match')}</TableHead>
                  <TableHead>{t('decisionShadow.columns.latency')}</TableHead>
                  <TableHead>{t('decisionShadow.columns.provider')}</TableHead>
                  <TableHead>{t('decisionShadow.columns.error')}</TableHead>
                  <TableHead>{t('decisionShadow.columns.traceId')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <DecisionShadowRow
                    key={row.id}
                    row={row}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {hasNextPage && (
            <div className="flex justify-center border-t border-slate-100 p-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage
                  ? t('activity.loadingMore')
                  : t('activity.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DecisionShadowRow({ row }: { row: DecisionShadowLog }) {
  const { t } = useTranslation('agent')

  return (
    <TableRow data-testid={`decision-shadow-row-${row.id}`}>
      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
        {formatDateTime(row.createdAt)}
      </TableCell>
      <TableCell className="text-xs text-slate-700">
        {t(`decisionShadow.useCases.${row.useCase}`)}
      </TableCell>
      <TableCell>
        {row.suggestion ? (
          <div className="space-y-0.5">
            <div className="font-mono text-xs text-slate-800">
              {row.suggestion.choice}
            </div>
            {row.suggestion.confidence !== null && (
              <div className="text-[11px] text-slate-500">
                {t('decisionShadow.confidence')}:{' '}
                {row.suggestion.confidence.toFixed(2)}
              </div>
            )}
            {row.suggestion.rationale && (
              <div
                className="max-w-xs truncate text-[11px] text-slate-500"
                title={row.suggestion.rationale}
              >
                {row.suggestion.rationale}
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-500">
            {t('decisionShadow.noSuggestion')}
          </span>
        )}
      </TableCell>
      <TableCell>
        {row.actualOutcome ? (
          <div className="space-y-0.5">
            <div className="font-mono text-xs text-slate-800">
              {row.actualOutcome.choice}
            </div>
            {row.actualOutcome.source && (
              <div className="text-[11px] text-slate-500">
                {row.actualOutcome.source}
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        )}
      </TableCell>
      <TableCell>
        {row.match === null ? (
          <span className="text-xs text-slate-500">—</span>
        ) : row.match ? (
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-emerald-800"
          >
            {t('decisionShadow.matchYes')}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 text-amber-800"
          >
            {t('decisionShadow.matchNo')}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-xs text-slate-700 whitespace-nowrap">
        {row.latencyMs === null ? '—' : `${row.latencyMs} ms`}
      </TableCell>
      <TableCell className="text-xs text-slate-500">
        {row.model ? `${row.provider} / ${row.model}` : row.provider}
      </TableCell>
      <TableCell className="max-w-xs">
        {row.error ? (
          <span className="text-xs text-rose-700 break-words">{row.error}</span>
        ) : (
          <span className="text-xs text-slate-500">—</span>
        )}
      </TableCell>
      <TableCell>
        <span
          className="font-mono text-xs text-slate-500"
          title={row.traceId}
        >
          {row.traceId.slice(0, 12)}...
        </span>
      </TableCell>
    </TableRow>
  )
}
