import { useState } from 'react'
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
import type {
  DecisionShadowLog,
  DecisionShadowUseCase,
} from '@/api/decision-shadow-logs'
import type { Language } from '../agent-supervision-copy'
import { getCopy, SUPERVISION_COPY } from '../agent-supervision-copy'
import { toLocalEndOfDayIso, toLocalStartOfDayIso } from './ActivityTab'

const USE_CASE_OPTIONS: DecisionShadowUseCase[] = [
  'import_row_matching',
  'document_sort',
]

interface DecisionShadowTabProps {
  language?: Language
}

/** Read-only shadow log view. It has filters and paging only; nothing here applies a suggestion. */
export function DecisionShadowTab({ language = 'en' }: DecisionShadowTabProps) {
  const [useCaseFilter, setUseCaseFilter] = useState<
    'ALL' | DecisionShadowUseCase
  >('ALL')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const t = SUPERVISION_COPY.decisionShadow
  const common = SUPERVISION_COPY.common
  const activity = SUPERVISION_COPY.activity

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
        {getCopy(t.description, language)}
      </p>

      {/* Filter toolbar: filters apply on change, so there is no Apply button */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="decision-shadow-use-case-select"
              className="text-xs text-slate-500 font-medium"
            >
              {getCopy(t.filters.useCaseLabel, language)}:
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
                {getCopy(t.filters.allUseCases, language)}
              </option>
              {USE_CASE_OPTIONS.map((useCase) => (
                <option key={useCase} value={useCase}>
                  {getCopy(t.useCases[useCase], language)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label
              htmlFor="decision-shadow-start-date"
              className="text-xs text-slate-500 font-medium"
            >
              {getCopy(activity.filters.startDateLabel, language)}:
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
              {getCopy(activity.filters.endDateLabel, language)}:
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
          aria-label={getCopy(common.retry, language)}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {getCopy(common.retry, language)}
        </Button>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          <RefreshCw
            className="mx-auto mb-3 h-6 w-6 animate-spin text-slate-400"
            aria-hidden="true"
          />
          {getCopy(common.loading, language)}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="text-sm font-medium text-rose-800">
            {getCopy(common.error, language)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="mt-3 border-rose-300 text-rose-700 hover:bg-rose-100"
          >
            {getCopy(common.retry, language)}
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
            {getCopy(t.emptyState, language)}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {getCopy(t.emptyStateDesc, language)}
          </p>
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table data-testid="decision-shadow-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{getCopy(t.columns.time, language)}</TableHead>
                  <TableHead>{getCopy(t.columns.useCase, language)}</TableHead>
                  <TableHead>{getCopy(t.columns.suggestion, language)}</TableHead>
                  <TableHead>
                    {getCopy(t.columns.actualOutcome, language)}
                  </TableHead>
                  <TableHead>{getCopy(t.columns.match, language)}</TableHead>
                  <TableHead>{getCopy(t.columns.latency, language)}</TableHead>
                  <TableHead>{getCopy(t.columns.provider, language)}</TableHead>
                  <TableHead>{getCopy(t.columns.error, language)}</TableHead>
                  <TableHead>{getCopy(t.columns.traceId, language)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <DecisionShadowRow
                    key={row.id}
                    row={row}
                    language={language}
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
                  ? getCopy(activity.loadingMore, language)
                  : getCopy(activity.loadMore, language)}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DecisionShadowRow({
  row,
  language,
}: {
  row: DecisionShadowLog
  language: Language
}) {
  const t = SUPERVISION_COPY.decisionShadow

  return (
    <TableRow data-testid={`decision-shadow-row-${row.id}`}>
      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
        {new Date(row.createdAt).toLocaleString()}
      </TableCell>
      <TableCell className="text-xs text-slate-700">
        {getCopy(t.useCases[row.useCase], language)}
      </TableCell>
      <TableCell>
        {row.suggestion ? (
          <div className="space-y-0.5">
            <div className="font-mono text-xs text-slate-800">
              {row.suggestion.choice}
            </div>
            {row.suggestion.confidence !== null && (
              <div className="text-[11px] text-slate-500">
                {getCopy(t.confidence, language)}:{' '}
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
            {getCopy(t.noSuggestion, language)}
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
            {getCopy(t.matchYes, language)}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 text-amber-800"
          >
            {getCopy(t.matchNo, language)}
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
