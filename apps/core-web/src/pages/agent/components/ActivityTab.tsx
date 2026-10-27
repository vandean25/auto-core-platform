import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { Copy, ExternalLink, Inbox, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
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
import { StatusBadge } from '@/components/status/StatusBadge'
import { useAgentActions } from '@/api/agent-actions'
import type { AgentActionStatus, AgentActionTier } from '@/api/agent-actions'
import { formatDateTime } from '@/lib/format'
import {
  resolveActivityAgentName,
  resolveDecidedByLabel,
  resolveUserId,
} from '../agent-labels'
import { parseActivityActionOrTraceSearch } from '../activity-search'

interface ActivityTabProps {
  onSelectTraceId: (traceId: string) => void
}

export function toLocalStartOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString()
}

export function toLocalEndOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
}

export function ActivityTab({
  onSelectTraceId,
}: ActivityTabProps) {
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [tierFilter, setTierFilter] = useState<string>('ALL')
  const [agentSearch, setAgentSearch] = useState<string>('')
  const [actionOrTraceSearch, setActionOrTraceSearch] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const actionOrTraceFilter = parseActivityActionOrTraceSearch(actionOrTraceSearch)

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
  } = useAgentActions({
    status:
      statusFilter !== 'ALL' ? (statusFilter as AgentActionStatus) : undefined,
    tier: tierFilter !== 'ALL' ? (tierFilter as AgentActionTier) : undefined,
    agentId: agentSearch.trim() || undefined,
    traceId: actionOrTraceFilter.traceId,
    actionType: actionOrTraceFilter.actionType,
    startDate: startDate ? toLocalStartOfDayIso(startDate) : undefined,
    endDate: endDate ? toLocalEndOfDayIso(endDate) : undefined,
    limit: 50,
  })

  const logs = logsData?.pages.flatMap((page) => page.data) ?? []

  const copyTraceId = async (traceId: string) => {
    try {
      await navigator.clipboard.writeText(traceId)
      toast.success(t('activity.traceIdCopied'))
    } catch {
      toast.error(t('activity.traceIdCopyFailed'))
    }
  }

  return (
    <div className="space-y-6" data-testid="activity-tab">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid w-full grid-cols-1 gap-3 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          {/* Agent search */}
          <div className="relative w-full sm:w-64">
            <Search
              className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              type="text"
              placeholder={t('activity.filters.agentPlaceholder')}
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              className="pl-9 text-xs"
              data-testid="filter-agent-input"
            />
          </div>

          <div className="relative w-full sm:w-72">
            <Search
              className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              type="text"
              placeholder={t('activity.filters.actionOrTracePlaceholder')}
              value={actionOrTraceSearch}
              onChange={(e) => setActionOrTraceSearch(e.target.value)}
              className="pl-9 text-xs"
              data-testid="filter-action-or-trace-input"
            />
          </div>

          {/* Status selector */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
            <label
              htmlFor="activity-status-select"
              className="text-xs text-slate-500 font-medium"
            >
              {t('activity.filters.statusLabel')}:
            </label>
            <select
              id="activity-status-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-base text-slate-700 shadow-sm focus:border-slate-500 focus:outline-none sm:w-auto md:text-xs"
              data-testid="filter-status-select"
            >
              <option value="ALL">
                {t('activity.filters.allStatuses')}
              </option>
              <option value="EXECUTED">EXECUTED</option>
              <option value="FAILED">FAILED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </div>

          {/* Tier selector */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
            <label
              htmlFor="activity-tier-select"
              className="text-xs text-slate-500 font-medium"
            >
              {t('activity.filters.tierLabel')}:
            </label>
            <select
              id="activity-tier-select"
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1 text-base text-slate-700 shadow-sm focus:border-slate-500 focus:outline-none sm:w-auto md:text-xs"
              data-testid="filter-tier-select"
            >
              <option value="ALL">
                {t('activity.filters.allTiers')}
              </option>
              <option value="AUTO">AUTO</option>
              <option value="PROPOSE">PROPOSE</option>
              <option value="HUMAN_ONLY">HUMAN_ONLY</option>
              <option value="NOT_EVALUATED">NOT_EVALUATED</option>
            </select>
          </div>

          {/* Date range filters */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
            <label
              htmlFor="activity-start-date"
              className="text-xs text-slate-500 font-medium"
            >
              {t('activity.filters.startDateLabel')}:
            </label>
            <Input
              id="activity-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 w-full text-xs sm:w-36"
              data-testid="filter-start-date-input"
            />
          </div>

          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
            <label
              htmlFor="activity-end-date"
              className="text-xs text-slate-500 font-medium"
            >
              {t('activity.filters.endDateLabel')}:
            </label>
            <Input
              id="activity-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 w-full text-xs sm:w-36"
              data-testid="filter-end-date-input"
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

      {/* Loading state */}
      {isLoading && (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          <RefreshCw
            className="mx-auto mb-3 h-6 w-6 animate-spin text-slate-400"
            aria-hidden="true"
          />
          {t('common.loading')}
        </div>
      )}

      {/* Error state */}
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

      {/* Empty state */}
      {!isLoading && !isError && logs.length === 0 && (
        <div
          className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center"
          data-testid="activity-empty-state"
        >
          <Inbox
            className="mx-auto mb-3 h-10 w-10 text-slate-400"
            aria-hidden="true"
          />
          <h3 className="text-base font-semibold text-slate-800">
            {t('activity.emptyState')}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {t('activity.emptyStateDesc')}
          </p>
        </div>
      )}

      {/* Activity Table */}
      {!isLoading && !isError && logs.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <Table data-testid="activity-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('activity.columns.time')}</TableHead>
                <TableHead>{t('activity.columns.agent')}</TableHead>
                <TableHead>{t('activity.columns.action')}</TableHead>
                <TableHead>{t('activity.columns.tier')}</TableHead>
                <TableHead>{t('activity.columns.status')}</TableHead>
                <TableHead>{t('activity.columns.approver')}</TableHead>
                <TableHead>{t('activity.columns.traceId')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const agentName = resolveActivityAgentName(log.agentId)
                const approverId = resolveUserId(log.onBehalfOfUserId)

                return (
                  <TableRow key={log.id} data-testid={`activity-row-${log.id}`}>
                    <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs font-semibold text-slate-800">
                      {agentName}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-700">
                      {log.actionType}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={log.tier} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={log.status} />
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {approverId ? (
                        <div
                          className="space-y-1"
                          data-testid={`activity-decided-by-${log.id}`}
                        >
                          <div className="text-slate-700">
                            {resolveDecidedByLabel(
                              {
                                name: log.onBehalfOfUserName,
                                email: log.onBehalfOfUserEmail,
                              },
                              t('common.unknownUser'),
                            )}
                          </div>
                          <details className="text-[11px] text-slate-500">
                            <summary className="cursor-pointer hover:text-slate-600">
                              {t('activity.showDetails')}
                            </summary>
                            <div className="mt-1 break-all font-mono">
                              {approverId}
                            </div>
                          </details>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {log.traceId ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onSelectTraceId(log.traceId)}
                            className="inline-flex items-center gap-1 font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                            data-testid={`activity-trace-btn-${log.id}`}
                          >
                            <span>{log.traceId.slice(0, 12)}...</span>
                            <ExternalLink
                              className="h-3 w-3"
                              aria-hidden="true"
                            />
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-500 hover:text-slate-800 max-sm:min-w-11"
                            aria-label={t('activity.copyTraceId')}
                            data-testid={`activity-trace-copy-btn-${log.id}`}
                            onClick={() => void copyTraceId(log.traceId)}
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
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
