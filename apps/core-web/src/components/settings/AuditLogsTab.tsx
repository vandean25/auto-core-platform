import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { format } from 'date-fns'
import { Eye, ShieldAlert, User, Server, Terminal, Filter } from 'lucide-react'
import type { AuditLog } from '@/api/audit'
import { useAuditLogs } from '@/api/audit'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'

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
  if (data === null || data === undefined) {
    return <span className="text-xs text-slate-400 italic">None</span>
  }

  const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2)

  return (
    <pre className="p-3 bg-slate-950 text-slate-100 rounded-md text-xs font-mono overflow-auto max-h-[350px] leading-relaxed select-text">
      <code>{formatted}</code>
    </pre>
  )
}

export function AuditLogsTab() {
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 20 })
  const [actionFilter, setActionFilter] = React.useState<'ALL' | 'CREATE' | 'UPDATE' | 'DELETE'>('ALL')
  const [selectedLog, setSelectedLog] = React.useState<AuditLog | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)

  const { data: responseData, isLoading } = useAuditLogs({
    limit: 100,
    action: actionFilter === 'ALL' ? undefined : actionFilter,
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
        header: ({ column }) => <DataTableColumnHeader column={column} title="Timestamp" />,
        cell: ({ row }) => {
          const date = new Date(row.original.occurredAt)
          return (
            <div className="flex flex-col text-xs">
              <span className="font-medium text-slate-800">{format(date, 'yyyy-MM-dd HH:mm:ss')}</span>
              <span className="text-slate-400 font-mono text-[10px]">{row.original.occurredAt}</span>
            </div>
          )
        },
      },
      {
        accessorKey: 'action',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Action" />,
        cell: ({ row }) => <StatusBadge status={row.original.action} />,
      },
      {
        accessorKey: 'entityType',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Entity Type" />,
        cell: ({ row }) => (
          <Badge variant="outline" className="font-semibold text-slate-700 bg-slate-50">
            {row.original.entityType}
          </Badge>
        ),
      },
      {
        accessorKey: 'entityId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Entity ID" />,
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
        header: 'Actor',
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
        header: 'Changed Fields',
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
            title="View Details"
          >
            <Eye className="h-4 w-4" />
          </button>
        ),
      },
    ],
    [handleRowClick],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">Audit Logs</h3>
          <p className="text-sm text-slate-500">
            Immutable, append-only audit trail of business entity mutations and deletions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <Select
            value={actionFilter}
            onValueChange={(val: 'ALL' | 'CREATE' | 'UPDATE' | 'DELETE') => setActionFilter(val)}
          >
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Actions</SelectItem>
              <SelectItem value="UPDATE">Update</SelectItem>
              <SelectItem value="DELETE">Delete</SelectItem>
              <SelectItem value="CREATE">Create</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={pagedLogs}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder="Search by entity, ID, actor, request ID..."
        setPagination={setPagination}
        onRowClick={handleRowClick}
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
                <SheetTitle className="text-xl">Audit Record Details</SheetTitle>
                <SheetDescription className="font-mono text-xs text-slate-500 break-all">
                  Target ID: {selectedLog.entityId}
                </SheetDescription>
              </SheetHeader>

              {/* Context Summary Cards */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <span className="text-slate-400 block mb-0.5">Occurred At</span>
                  <span className="font-medium text-slate-800">
                    {format(new Date(selectedLog.occurredAt), 'yyyy-MM-dd HH:mm:ss')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Actor Type</span>
                  <span className="font-medium text-slate-800">{selectedLog.actorType}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Actor Email</span>
                  <span className="font-medium text-slate-800 truncate block" title={selectedLog.actorEmail ?? '—'}>
                    {selectedLog.actorEmail ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Actor Role</span>
                  <span className="font-medium text-slate-800">{selectedLog.actorRole ?? '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Request ID</span>
                  <span className="font-mono text-[11px] text-slate-700 truncate block" title={selectedLog.requestId ?? '—'}>
                    {selectedLog.requestId ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Source / IP</span>
                  <span className="font-mono text-[11px] text-slate-700 truncate block">
                    {selectedLog.source ?? 'API'} {selectedLog.ipAddress ? `(${selectedLog.ipAddress})` : ''}
                  </span>
                </div>
              </div>

              {/* Redacted fields alert */}
              {selectedLog.redactedFields && selectedLog.redactedFields.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-xs">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <span className="font-medium">Redacted Secret Fields:</span>{' '}
                    {selectedLog.redactedFields.join(', ')}
                  </div>
                </div>
              )}

              {/* Changed Fields */}
              {selectedLog.changedFields && selectedLog.changedFields.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">Modified Fields:</span>
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
                <span className="text-xs font-semibold text-slate-700">State Payloads:</span>
                <Tabs defaultValue="diff" className="w-full">
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="diff">Diff</TabsTrigger>
                    <TabsTrigger value="before">Before</TabsTrigger>
                    <TabsTrigger value="after">After</TabsTrigger>
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
