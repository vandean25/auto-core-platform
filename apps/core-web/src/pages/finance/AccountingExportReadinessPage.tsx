import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import {
  useAccountingExportReadiness,
  type AccountingExportBlockerCode,
  type AccountingExportDocumentKind,
  type AccountingExportReadinessDocument,
} from '@/api/useAccountingExportReadiness'
import { useLegalEntities } from '@/api/site-admin'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { cn } from '@/lib/utils'

const ALL_FILTER_VALUE = 'all'

const REASON_LABELS: Record<AccountingExportBlockerCode, string> = {
  LEGACY_DOCUMENT_UNSUPPORTED: 'Legacy document',
  UNSUPPORTED_EXPORT_TAX_MODE: 'Unsupported tax mode',
  UNSUPPORTED_EXPORT_COUNTRY: 'Outside DE export',
  ACCOUNTING_MAPPING_INCOMPLETE: 'Mapping incomplete',
  MISSING_OWNERSHIP_EVIDENCE: 'Ownership evidence missing',
  CANCELLED_DOCUMENT: 'Cancelled',
  INACTIVE_SITE_BLOCKED: 'Inactive site',
}

const DOCUMENT_KIND_LABELS: Record<AccountingExportDocumentKind, string> = {
  INVOICE: 'Invoice',
  CREDIT_NOTE: 'Credit note',
}

const STATUS_LABELS: Record<AccountingExportReadinessDocument['status'], string> = {
  EXPORTABLE: 'Exportable',
  BLOCKED: 'Blocked',
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))

const formatIsoDate = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// The previous calendar month is the usual closed period to check before export.
const previousMonthRange = (today: Date) => ({
  dateFrom: formatIsoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
  dateTo: formatIsoDate(new Date(today.getFullYear(), today.getMonth(), 0)),
})

const columns: ColumnDef<AccountingExportReadinessDocument>[] = [
  {
    accessorKey: 'number',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Document" />
    ),
    cell: ({ row }) => (
      <div className="font-medium">
        {row.original.number ?? `Draft ${row.original.id.slice(0, 8)}`}
      </div>
    ),
  },
  {
    accessorKey: 'kind',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
    cell: ({ row }) => <div>{DOCUMENT_KIND_LABELS[row.original.kind]}</div>,
  },
  {
    accessorKey: 'date',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
    cell: ({ row }) => <div>{formatDate(row.original.date)}</div>,
  },
  {
    id: 'site',
    accessorFn: (row) => row.site?.code ?? '',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Site" />,
    cell: ({ row }) => <div>{row.original.site?.code ?? '—'}</div>,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        label={STATUS_LABELS[row.original.status]}
      />
    ),
  },
  {
    id: 'reasons',
    accessorFn: (row) => row.blockers.map((blocker) => blocker.code).join(' '),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Reasons" />
    ),
    cell: ({ row }) => (
      <div className="max-w-[360px] truncate">
        {row.original.blockers
          .map((blocker) => REASON_LABELS[blocker.code])
          .join(', ') || '—'}
      </div>
    ),
  },
]

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number | undefined
  tone?: 'positive' | 'negative'
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            'text-2xl font-semibold tabular-nums',
            tone === 'positive' && 'text-emerald-600',
            tone === 'negative' && 'text-rose-600',
          )}
        >
          {value ?? '—'}
        </p>
      </CardContent>
    </Card>
  )
}

export default function AccountingExportReadinessPage() {
  const navigate = useNavigate()
  const legalEntitiesQuery = useLegalEntities()
  const legalEntities = legalEntitiesQuery.data ?? []

  const [selectedEntityId, setSelectedEntityId] = useState('')
  const legalEntityId =
    selectedEntityId ||
    legalEntities.find((entity) => entity.is_active)?.id ||
    legalEntities[0]?.id ||
    ''

  const [period, setPeriod] = useState(() => previousMonthRange(new Date()))
  const [reason, setReason] = useState<AccountingExportBlockerCode | ''>('')
  const [documentKind, setDocumentKind] = useState<
    AccountingExportDocumentKind | ''
  >('')

  const { queryParams, ...tableState } = useDataTableQuery({
    defaultPageSize: 25,
  })

  const readiness = useAccountingExportReadiness(
    legalEntityId
      ? {
          legalEntityId,
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
          reason: reason || undefined,
          documentKind: documentKind || undefined,
          search: queryParams.search || undefined,
          page: queryParams.page,
          limit: queryParams.pageSize,
        }
      : null,
  )

  const response = readiness.data
  const summary = response?.summary
  const documents = response?.data ?? []
  const pageCount = response?.meta.pageCount ?? 1
  const tenantWideBlockers = response?.tenantWideBlockers ?? []

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Accounting export readiness
          </h1>
          <p className="text-slate-500">
            Which documents in a period can be exported, and why the rest are blocked.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate(APP_ROUTE_PATHS.settings)}>
          Open Settings
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-5 mb-6">
        <div className="space-y-1.5">
          <Label htmlFor="readiness-entity">Legal entity</Label>
          <Select
            value={legalEntityId}
            onValueChange={setSelectedEntityId}
            disabled={legalEntities.length === 0}
          >
            <SelectTrigger id="readiness-entity">
              <SelectValue placeholder="Choose a legal entity" />
            </SelectTrigger>
            <SelectContent>
              {legalEntities.map((entity) => (
                <SelectItem key={entity.id} value={entity.id}>
                  {entity.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="readiness-from">From</Label>
          <Input
            id="readiness-from"
            type="date"
            value={period.dateFrom}
            onChange={(event) =>
              setPeriod((current) => ({ ...current, dateFrom: event.target.value }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="readiness-to">To</Label>
          <Input
            id="readiness-to"
            type="date"
            value={period.dateTo}
            onChange={(event) =>
              setPeriod((current) => ({ ...current, dateTo: event.target.value }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="readiness-reason">Reason</Label>
          <Select
            value={reason || ALL_FILTER_VALUE}
            onValueChange={(value) =>
              setReason(
                value === ALL_FILTER_VALUE
                  ? ''
                  : (value as AccountingExportBlockerCode),
              )
            }
          >
            <SelectTrigger id="readiness-reason">
              <SelectValue placeholder="All reasons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All reasons</SelectItem>
              {(Object.keys(REASON_LABELS) as AccountingExportBlockerCode[]).map(
                (code) => (
                  <SelectItem key={code} value={code}>
                    {REASON_LABELS[code]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="readiness-kind">Document type</Label>
          <Select
            value={documentKind || ALL_FILTER_VALUE}
            onValueChange={(value) =>
              setDocumentKind(
                value === ALL_FILTER_VALUE
                  ? ''
                  : (value as AccountingExportDocumentKind),
              )
            }
          >
            <SelectTrigger id="readiness-kind">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All types</SelectItem>
              {(Object.keys(DOCUMENT_KIND_LABELS) as AccountingExportDocumentKind[]).map(
                (kind) => (
                  <SelectItem key={kind} value={kind}>
                    {DOCUMENT_KIND_LABELS[kind]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {readiness.error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{readiness.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {legalEntityId ? (
        <>
          <section
            aria-label="Readiness summary"
            className="grid gap-4 md:grid-cols-4 mb-6"
          >
            <SummaryCard label="Documents" value={summary?.documentCount} />
            <SummaryCard
              label="Exportable"
              value={summary?.exportableCount}
              tone="positive"
            />
            <SummaryCard
              label="Blocked"
              value={summary?.blockedCount}
              tone="negative"
            />
            <SummaryCard
              label="Period"
              value={
                response ? (response.periodClosed ? 'Closed' : 'Open') : undefined
              }
            />
          </section>

          {summary && summary.reasons.length > 0 ? (
            <div
              aria-label="Blocker reasons"
              className="flex flex-wrap gap-2 mb-6"
            >
              {summary.reasons.map((item) => {
                const selected = reason === item.code
                return (
                  <button
                    key={item.code}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setReason(selected ? '' : item.code)}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-sm transition-colors',
                      selected
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {REASON_LABELS[item.code]}{' '}
                    <span className="tabular-nums">{item.documentCount}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {tenantWideBlockers.length > 0 ? (
            <Alert className="mb-6">
              <AlertDescription>
                <p className="font-medium">
                  {tenantWideBlockers.length === 1
                    ? 'One issue applies to every export in this period.'
                    : `${tenantWideBlockers.length} issues apply to every export in this period.`}
                </p>
                <ul className="mt-2 list-disc pl-5">
                  {tenantWideBlockers.map((blocker, index) => (
                    <li key={`${blocker.code}-${blocker.documentId ?? index}`}>
                      {blocker.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <DataTable
            columns={columns}
            data={documents}
            pageCount={pageCount}
            isLoading={readiness.isLoading}
            searchPlaceholder="Search documents..."
            emptyStateMessage="No documents match these filters."
            onRowClick={(row) => navigate(row.href)}
            {...tableState}
          />
        </>
      ) : (
        <p className="text-slate-500">
          Choose a legal entity to see its export readiness.
        </p>
      )}
    </>
  )
}
