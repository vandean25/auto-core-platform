import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Eye, ShieldAlert, User, Server, Terminal, Filter } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import type { AuditLog } from '@/api/audit'
import { useAuditLogs } from '@/api/audit'
import { useWorkshopSettings } from '@/api/workshop'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { formatIsoDateTimeInZone } from '@/lib/format'

const DEFAULT_TIMEZONE = 'Europe/Vienna'

export function formatAuditTimestamp(timestamp: string, timezone: string): string {
  return formatIsoDateTimeInZone(timestamp, timezone) ?? '—'
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase()
}

function matchesAuditSearch(log: AuditLog, term: string): boolean {
  if (!term) return true
  const target = [
    log.entityType,
    log.entityId,
    log.action,
    log.actorEmail ?? '',
    log.actorUserId ?? '',
    log.requestId ?? '',
    log.source ?? '',
    ...(log.changedFields ?? []),
  ]
    .join(' ')
    .toLowerCase()

  return target.includes(term)
}

function sortAuditLogs(logs: AuditLog[], sortField?: string, sortDirection?: 'asc' | 'desc'): AuditLog[] {
  if (!sortField || !sortDirection) return logs
  const direction = sortDirection === 'desc' ? -1 : 1

  return [...logs].sort((left, right) => {
    if (sortField === 'occurredAt') {
      return direction * (new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime())
    }
    if (sortField === 'action') {
      return direction * left.action.localeCompare(right.action)
    }
    if (sortField === 'entityType') {
      return direction * left.entityType.localeCompare(right.entityType)
    }
    if (sortField === 'entityId') {
      return direction * left.entityId.localeCompare(right.entityId)
    }
    return 0
  })
}

function JsonViewer({ data }: { data: unknown }) {
  const { t } = useTranslation('settings')
  if (data === null || data === undefined) {
    return <span className="text-xs text-slate-400 italic">{t('auditLogs.jsonNone')}</span>
  }

  const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2)

  return (
    <pre className="p-3 bg-slate-950 text-slate-100 rounded-md text-xs font-mono overflow-auto max-h-[350px] leading-relaxed select-text">
      <code>{formatted}</code>
    </pre>
  )
}

export function AuditLogsTab() {
  const { t } = useTranslation('settings')
  const [searchParams] = useSearchParams()
  const initialEntityType = searchParams.get('auditEntityType') ?? undefined
  const initialEntityId = searchParams.get('auditEntityId') ?? undefined
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 20 })
  const [actionFilter, setActionFilter] = React.useState<'ALL' | 'CREATE' | 'UPDATE' | 'DELETE'>('ALL')
  const [entityTypeFilter, setEntityTypeFilter] = React.useState(initialEntityType ?? '')
  const [entityIdFilter, setEntityIdFilter] = React.useState(initialEntityId ?? '')
  const [selectedLog, setSelectedLog] = React.useState<AuditLog | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const { data: workshopSettings } = useWorkshopSettings()
  const timezone = workshopSettings?.timezone ?? DEFAULT_TIMEZONE

  const { data: responseData, isLoading } = useAuditLogs({
    limit: 100,
    action: actionFilter === 'ALL' ? undefined : actionFilter,
    entityType: entityTypeFilter.trim() || undefined,
    entityId: entityIdFilter.trim() || undefined,
  })

  const logs = React.useMemo(() => responseData?.data ?? [], [responseData?.data])

  const filteredLogs = React.useMemo(() => {
    const term = normalizeSearch(queryParams.search ?? '')
    return logs.filter((log) => matchesAuditSearch(log, term))
  }, [logs, queryParams.search])

  const sortedLogs = React.useMemo(
    () => sortAuditLogs(filteredLogs, queryParams.sortField, queryParams.sortDirection),
    [filteredLogs, queryParams.sortDirection, queryParams.sortField],
  )

  const pagedLogs = React.useMemo(() => {
    const start = (queryParams.page - 1) * queryParams.pageSize
    return sortedLogs.slice(start, start + queryParams.pageSize)
  }, [sortedLogs, queryParams.page, queryParams.pageSize])

  const pageCount = Math.max(1, Math.ceil(sortedLogs.length / queryParams.pageSize))

  const handleRowClick = React.useCallback((log: AuditLog) => {
    setSelectedLog(log)
    setDetailOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<AuditLog>[]>(
    () => [
      {
        accessorKey: 'occurredAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('auditLogs.columns.timestamp')} />,
        cell: ({ row }) => {
          return (
            <div className="flex flex-col text-xs">
              <span className="font-medium text-slate-800">
                {formatAuditTimestamp(row.original.occurredAt, timezone)}
              </span>
              <span className="text-slate-400 font-mono text-[10px]">{row.original.occurredAt}</span>
            </div>
          )
        },
      },
      {
        accessorKey: 'action',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('auditLogs.columns.action')} />,
        cell: ({ row }) => <StatusBadge status={row.original.action} />,
      },
      {
        accessorKey: 'entityType',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('auditLogs.columns.entityType')} />,
        cell: ({ row }) => (
          <Badge variant="outline" className="font-semibold text-slate-700 bg-slate-50">
            {row.original.entityType}
          </Badge>
        ),
      },
      {
        accessorKey: 'entityId',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('auditLogs.columns.entityId')} />,
        cell: ({ row }) => (
          <span
            className="font-mono text-xs text-slate-600 truncate max-w-[130px] block"
            title={row.original.entityId}
          >
            {row.original.entityId}
          </span>
        ),
      },
      {
        id: 'actor',
        header: t('auditLogs.columns.actor'),
        cell: ({ row }) => {
          const email = row.original.actorEmail
          const userId = row.original.actorUserId
          const actorType = row.original.actorType
          return (
            <div className="flex items-center gap-1.5 text-xs text-slate-700">
              {actorType === 'USER' ? (
                <User className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              ) : actorType === 'SYSTEM' ? (
                <Server className="h-3.5 w-3.5 text-purple-500 shrink-0" />
              ) : (
                <Terminal className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              )}
              <span className="truncate max-w-[160px]" title={email ?? userId ?? actorType}>
                {email || userId || actorType}
              </span>
            </div>
          )
        },
      },
      {
        accessorKey: 'changedFields',
        header: t('auditLogs.columns.changedFields'),
        cell: ({ row }) => {
          const fields = row.original.changedFields
          if (!fields || fields.length === 0) {
            return <span className="text-xs text-slate-400">—</span>
          }
          return (
            <div className="flex flex-wrap gap-1 max-w-[220px]">
              {fields.slice(0, 3).map((field) => (
                <Badge key={field} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {field}
                </Badge>
              ))}
              {fields.length > 3 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-slate-500">
                  +{fields.length - 3}
                </Badge>
              )}
            </div>
          )
        },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 p-1 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              handleRowClick(row.original)
            }}
            aria-label={t('auditLogs.viewDetailsAria', {
              action: row.original.action,
              entityType: row.original.entityType,
              entityId: row.original.entityId,
              occurredAt: row.original.occurredAt,
            })}
            title={t('auditLogs.viewDetails')}
          >
            <Eye className="h-4 w-4" />
          </button>
        ),
      },
    ],
    [handleRowClick, t, timezone],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">{t('auditLogs.title')}</h3>
          <p className="text-sm text-slate-500">
            {t('auditLogs.description')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <Select
            value={actionFilter}
            onValueChange={(val: 'ALL' | 'CREATE' | 'UPDATE' | 'DELETE') => setActionFilter(val)}
          >
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder={t('auditLogs.filters.action')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('auditLogs.filters.allActions')}</SelectItem>
              <SelectItem value="UPDATE">{t('auditLogs.filters.update')}</SelectItem>
              <SelectItem value="DELETE">{t('auditLogs.filters.delete')}</SelectItem>
              <SelectItem value="CREATE">{t('auditLogs.filters.create')}</SelectItem>
            </SelectContent>
          </Select>
          <input
            type="search"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm w-[140px]"
            placeholder={t('auditLogs.filters.entityTypePlaceholder')}
            value={entityTypeFilter}
            onChange={(event) => setEntityTypeFilter(event.target.value)}
            aria-label={t('auditLogs.filters.entityType')}
          />
          <input
            type="search"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm w-[200px]"
            placeholder={t('auditLogs.filters.entityIdPlaceholder')}
            value={entityIdFilter}
            onChange={(event) => setEntityIdFilter(event.target.value)}
            aria-label={t('auditLogs.filters.entityId')}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={pagedLogs}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder={t('auditLogs.searchPlaceholder')}
        setPagination={setPagination}
        rowBehaviour={{ onRowClick: handleRowClick }}
        {...tableState}
      />

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedLog && (
            <div className="space-y-6 py-4">
              <SheetHeader>
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={selectedLog.action} />
                  <Badge variant="outline" className="font-semibold">
                    {selectedLog.entityType}
                  </Badge>
                </div>
                <SheetTitle className="text-xl">{t('auditLogs.sheet.title')}</SheetTitle>
                <SheetDescription className="font-mono text-xs text-slate-500 break-all">
                  {t('auditLogs.sheet.targetId', { id: selectedLog.entityId })}
                </SheetDescription>
              </SheetHeader>

              {/* Context Summary Cards */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <span className="text-slate-400 block mb-0.5">{t('auditLogs.sheet.occurredAt')}</span>
                  <span className="font-medium text-slate-800">
                    {formatAuditTimestamp(selectedLog.occurredAt, timezone)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">{t('auditLogs.sheet.actorType')}</span>
                  <span className="font-medium text-slate-800">{selectedLog.actorType}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">{t('auditLogs.sheet.actorEmail')}</span>
                  <span className="font-medium text-slate-800 truncate block" title={selectedLog.actorEmail ?? '—'}>
                    {selectedLog.actorEmail ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">{t('auditLogs.sheet.actorRole')}</span>
                  <span className="font-medium text-slate-800">{selectedLog.actorRole ?? '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">{t('auditLogs.sheet.requestId')}</span>
                  <span className="font-mono text-[11px] text-slate-700 truncate block" title={selectedLog.requestId ?? '—'}>
                    {selectedLog.requestId ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">{t('auditLogs.sheet.sourceIp')}</span>
                  <span className="font-mono text-[11px] text-slate-700 truncate block">
                    {selectedLog.source ?? t('auditLogs.sheet.sourceApi')} {selectedLog.ipAddress ? `(${selectedLog.ipAddress})` : ''}
                  </span>
                </div>
              </div>

              {/* Redacted fields alert */}
              {selectedLog.redactedFields && selectedLog.redactedFields.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-xs">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <span className="font-medium">{t('auditLogs.sheet.redactedTitle')}</span>{' '}
                    {selectedLog.redactedFields.join(', ')}
                  </div>
                </div>
              )}

              {/* Changed Fields */}
              {selectedLog.changedFields && selectedLog.changedFields.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">{t('auditLogs.sheet.modifiedFields')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedLog.changedFields.map((field) => (
                      <Badge key={field} variant="secondary" className="text-xs">
                        {field}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Data Diff Tabs */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-700">{t('auditLogs.sheet.statePayloads')}</span>
                <Tabs defaultValue="diff" className="w-full">
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="diff">{t('auditLogs.sheet.tabs.diff')}</TabsTrigger>
                    <TabsTrigger value="before">{t('auditLogs.sheet.tabs.before')}</TabsTrigger>
                    <TabsTrigger value="after">{t('auditLogs.sheet.tabs.after')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="diff" className="pt-2">
                    <JsonViewer data={selectedLog.diff} />
                  </TabsContent>
                  <TabsContent value="before" className="pt-2">
                    <JsonViewer data={selectedLog.before} />
                  </TabsContent>
                  <TabsContent value="after" className="pt-2">
                    <JsonViewer data={selectedLog.after} />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
