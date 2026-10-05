import { useState } from 'react'
import { ExternalLink, Inbox, RefreshCw, Search } from 'lucide-react'
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
import type { Language } from '../agent-supervision-copy'
import { getCopy, SUPERVISION_COPY } from '../agent-supervision-copy'

interface ActivityTabProps {
  language?: Language
  onSelectTraceId: (traceId: string) => void
}

export function ActivityTab({ language = 'en', onSelectTraceId }: ActivityTabProps) {
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [tierFilter, setTierFilter] = useState<string>('ALL')
  const [agentSearch, setAgentSearch] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const t = SUPERVISION_COPY.activity
  const common = SUPERVISION_COPY.common

  const {
    data: logsData,
    isLoading,
    isError,
    refetch,
  } = useAgentActions({
    status: statusFilter !== 'ALL' ? (statusFilter as AgentActionStatus) : undefined,
    tier: tierFilter !== 'ALL' ? (tierFilter as AgentActionTier) : undefined,
    agentId: agentSearch.trim() || undefined,
    startDate: startDate ? `${startDate}T00:00:00.000Z` : undefined,
    endDate: endDate ? `${endDate}T23:59:59.999Z` : undefined,
    limit: 50,
  })

  const logs = logsData?.data ?? []

  return (
    <div className="space-y-6" data-testid="activity-tab">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* Agent search */}
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <Input
              type="text"
              placeholder={getCopy(t.filters.agentPlaceholder, language)}
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              className="pl-9 text-xs"
              data-testid="filter-agent-input"
            />
          </div>

          {/* Status selector */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="activity-status-select" className="text-xs text-slate-500 font-medium">
              {getCopy(t.filters.statusLabel, language)}:
            </label>
            <select
              id="activity-status-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm focus:border-slate-500 focus:outline-none"
              data-testid="filter-status-select"
            >
              <option value="ALL">{getCopy(t.filters.allStatuses, language)}</option>
              <option value="EXECUTED">EXECUTED</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>

          {/* Tier selector */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="activity-tier-select" className="text-xs text-slate-500 font-medium">
              {getCopy(t.filters.tierLabel, language)}:
            </label>
            <select
              id="activity-tier-select"
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm focus:border-slate-500 focus:outline-none"
              data-testid="filter-tier-select"
            >
              <option value="ALL">{getCopy(t.filters.allTiers, language)}</option>
              <option value="AUTO">AUTO</option>
              <option value="PROPOSE">PROPOSE</option>
              <option value="HUMAN_ONLY">HUMAN_ONLY</option>
            </select>
          </div>

          {/* Date range filters */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="activity-start-date" className="text-xs text-slate-500 font-medium">
              {getCopy(t.filters.startDateLabel, language)}:
            </label>
            <Input
              id="activity-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 w-36 text-xs"
              data-testid="filter-start-date-input"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor="activity-end-date" className="text-xs text-slate-500 font-medium">
              {getCopy(t.filters.endDateLabel, language)}:
            </label>
            <Input
              id="activity-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 w-36 text-xs"
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
          aria-label={getCopy(common.retry, language)}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {getCopy(common.retry, language)}
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
          {getCopy(common.loading, language)}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="text-sm font-medium text-rose-800">{getCopy(common.error, language)}</p>
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

      {/* Empty state */}
      {!isLoading && !isError && logs.length === 0 && (
        <div
          className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center"
          data-testid="activity-empty-state"
        >
          <Inbox className="mx-auto mb-3 h-10 w-10 text-slate-400" aria-hidden="true" />
          <h3 className="text-base font-semibold text-slate-800">{getCopy(t.emptyState, language)}</h3>
          <p className="mt-1 text-sm text-slate-500">{getCopy(t.emptyStateDesc, language)}</p>
        </div>
      )}

      {/* Activity Table */}
      {!isLoading && !isError && logs.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <Table data-testid="activity-table">
            <TableHeader>
              <TableRow>
                <TableHead>{getCopy(t.columns.time, language)}</TableHead>
                <TableHead>{getCopy(t.columns.agent, language)}</TableHead>
                <TableHead>{getCopy(t.columns.action, language)}</TableHead>
                <TableHead>{getCopy(t.columns.tier, language)}</TableHead>
                <TableHead>{getCopy(t.columns.status, language)}</TableHead>
                <TableHead>{getCopy(t.columns.approver, language)}</TableHead>
                <TableHead>{getCopy(t.columns.traceId, language)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const agentName = typeof log.agentId === 'string' ? log.agentId : 'agent'
                const approver = typeof log.onBehalfOfUserId === 'string' ? log.onBehalfOfUserId : null

                return (
                  <TableRow key={log.id} data-testid={`activity-row-${log.id}`}>
                    <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
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
                      {approver ?? '—'}
                    </TableCell>
                    <TableCell>
                      {log.traceId ? (
                        <button
                          type="button"
                          onClick={() => onSelectTraceId(log.traceId)}
                          className="inline-flex items-center gap-1 font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                          data-testid={`activity-trace-btn-${log.id}`}
                        >
                          <span>{log.traceId.slice(0, 12)}...</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
