import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import {
  useAccountingExportReadiness,
  type AccountingExportBlockerCode,
  type AccountingExportDocumentKind,
  type AccountingExportReadinessDocument,
  type AccountingExportReadinessSortField,
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
import { formatDateShort } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const ALL_FILTER_VALUE = 'all'

const FILTERABLE_REASON_CODES = (
  [
    'LEGACY_DOCUMENT_UNSUPPORTED',
    'UNSUPPORTED_EXPORT_TAX_MODE',
    'UNSUPPORTED_EXPORT_COUNTRY',
    'ACCOUNTING_MAPPING_INCOMPLETE',
    'MISSING_OWNERSHIP_EVIDENCE',
    'CANCELLED_DOCUMENT',
    'INACTIVE_SITE_BLOCKED',
  ] as AccountingExportBlockerCode[]
).filter((code) => code !== 'INACTIVE_SITE_BLOCKED')

const SORT_FIELDS: readonly AccountingExportReadinessSortField[] = [
  'number',
  'kind',
  'date',
  'site',
  'status',
]

const toSortField = (value: string | undefined) =>
  SORT_FIELDS.find((field) => field === value)

const MAX_SEARCH_LENGTH = 200
const MAX_PAGE_SIZE = 100

const formatDate = (value: string) => formatDateShort(value, { timeZone: 'UTC' })

const formatIsoDate = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const previousMonthRange = (today: Date) => ({
  dateFrom: formatIsoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
  dateTo: formatIsoDate(new Date(today.getFullYear(), today.getMonth(), 0)),
})

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number | undefined
  tone?: 'positive' | 'negative'
}) {
  const { t } = useTranslation('finance')
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
          {value ?? t('placeholders.missing', { ns: 'common' })}
        </p>
      </CardContent>
    </Card>
  )
}

export default function AccountingExportReadinessPage() {
  const { t } = useTranslation('finance')
  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

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

  const {
    queryParams,
    setPagination,
    setGlobalFilter,
    ...tableState
  } = useDataTableQuery({
    defaultPageSize: 25,
    initialSorting: [{ id: 'date', desc: false }],
  })

  const resetToFirstPage = () =>
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    )

  const changeSearch: Dispatch<SetStateAction<string>> = (value) => {
    setGlobalFilter(value)
    resetToFirstPage()
  }

  const readiness = useAccountingExportReadiness(
    legalEntityId
      ? {
          legalEntityId,
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
          reason: reason || undefined,
          documentKind: documentKind || undefined,
          search: (queryParams.search ?? '').slice(0, MAX_SEARCH_LENGTH) || undefined,
          sortField: toSortField(queryParams.sortField),
          sortDirection:
            queryParams.sortDirection === 'desc'
              ? 'desc'
              : queryParams.sortDirection === 'asc'
                ? 'asc'
                : undefined,
          page: Math.max(1, Math.trunc(queryParams.page)),
          limit: Math.min(Math.max(1, Math.trunc(queryParams.pageSize)), MAX_PAGE_SIZE),
        }
      : null,
  )

  const response = readiness.data
  const summary = response?.summary
  const documents = response?.data ?? []
  const pageCount = response?.meta.pageCount ?? 1
  const tenantWideBlockers = response?.tenantWideBlockers ?? []

  const documentKindCodes = useMemo(
    () => ['INVOICE', 'CREDIT_NOTE'] as AccountingExportDocumentKind[],
    [],
  )

  const columns: ColumnDef<AccountingExportReadinessDocument>[] = useMemo(
    () => [
      {
        accessorKey: 'number',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.document')} />
        ),
        cell: ({ row }) => (
          <div className="font-medium">
            {row.original.number ??
              t('shared.draftLabel', { id: row.original.id.slice(0, 8) })}
          </div>
        ),
      },
      {
        accessorKey: 'kind',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.type')} />
        ),
        cell: ({ row }) => (
          <div>{t(`accountingExportReadiness.documentKind.${row.original.kind}`)}</div>
        ),
      },
      {
        accessorKey: 'date',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.date')} />
        ),
        cell: ({ row }) => <div>{formatDate(row.original.date)}</div>,
      },
      {
        id: 'site',
        accessorFn: (row) => row.site?.code ?? '',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.site')} />
        ),
        cell: ({ row }) => (
          <div>{row.original.site?.code ?? t('placeholders.missing', { ns: 'common' })}</div>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.status')} />
        ),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'reasons',
        enableSorting: false,
        accessorFn: (row) => row.blockers.map((blocker) => blocker.code).join(' '),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('columns.reasons')} />
        ),
        cell: ({ row }) => (
          <div className="max-w-[360px] truncate">
            {row.original.blockers
              .map((blocker) =>
                t(`accountingExportReadiness.blockers.${blocker.code}`),
              )
              .join(', ') || t('placeholders.missing', { ns: 'common' })}
          </div>
        ),
      },
    ],
    [t],
  )

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('accountingExportReadiness.title')}
          </h1>
          <p className="text-slate-500">{t('accountingExportReadiness.subtitle')}</p>
        </div>
        <Button variant="outline" onClick={() => navigate(APP_ROUTE_PATHS.settings)}>
          {t('actions.openSettings')}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-5 mb-6">
        <div className="space-y-1.5">
          <Label htmlFor="readiness-entity">{t('accountingExportReadiness.legalEntity')}</Label>
          <Select
            value={legalEntityId}
            onValueChange={(id) => {
              setSelectedEntityId(id)
              resetToFirstPage()
            }}
            disabled={legalEntities.length === 0}
          >
            <SelectTrigger id="readiness-entity">
              <SelectValue placeholder={t('accountingExportReadiness.chooseLegalEntity')} />
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
          <Label htmlFor="readiness-from">{t('accountingExportReadiness.from')}</Label>
          <Input
            id="readiness-from"
            type="date"
            value={period.dateFrom}
            onChange={(event) => {
              setPeriod((current) => ({ ...current, dateFrom: event.target.value }))
              resetToFirstPage()
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="readiness-to">{t('accountingExportReadiness.to')}</Label>
          <Input
            id="readiness-to"
            type="date"
            value={period.dateTo}
            onChange={(event) => {
              setPeriod((current) => ({ ...current, dateTo: event.target.value }))
              resetToFirstPage()
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="readiness-reason">{t('accountingExportReadiness.reasonFilter')}</Label>
          <Select
            value={reason || ALL_FILTER_VALUE}
            onValueChange={(value) => {
              setReason(
                value === ALL_FILTER_VALUE
                  ? ''
                  : (value as AccountingExportBlockerCode),
              )
              resetToFirstPage()
            }}
          >
            <SelectTrigger id="readiness-reason">
              <SelectValue placeholder={t('accountingExportReadiness.allReasons')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>
                {t('accountingExportReadiness.allReasons')}
              </SelectItem>
              {FILTERABLE_REASON_CODES.map((code) => (
                <SelectItem key={code} value={code}>
                  {t(`accountingExportReadiness.blockers.${code}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="readiness-kind">{t('accountingExportReadiness.documentType')}</Label>
          <Select
            value={documentKind || ALL_FILTER_VALUE}
            onValueChange={(value) => {
              setDocumentKind(
                value === ALL_FILTER_VALUE
                  ? ''
                  : (value as AccountingExportDocumentKind),
              )
              resetToFirstPage()
            }}
          >
            <SelectTrigger id="readiness-kind">
              <SelectValue placeholder={t('accountingExportReadiness.allTypes')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>
                {t('accountingExportReadiness.allTypes')}
              </SelectItem>
              {documentKindCodes.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`accountingExportReadiness.documentKind.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!legalEntityId ? (
        <p className="text-slate-500">{t('accountingExportReadiness.chooseLegalEntityHint')}</p>
      ) : readiness.error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{readiness.error.message}</AlertDescription>
        </Alert>
      ) : (
        <>
          <section
            aria-label={t('accountingExportReadiness.summaryRegion')}
            className="grid gap-4 md:grid-cols-4 mb-6"
          >
            <SummaryCard
              label={t('accountingExportReadiness.documents')}
              value={summary?.documentCount}
            />
            <SummaryCard
              label={t('accountingExportReadiness.exportable')}
              value={summary?.exportableCount}
              tone="positive"
            />
            <SummaryCard
              label={t('accountingExportReadiness.blocked')}
              value={summary?.blockedCount}
              tone="negative"
            />
            <SummaryCard
              label={t('accountingExportReadiness.period')}
              value={
                response
                  ? response.periodClosed
                    ? t('accountingExportReadiness.periodClosed')
                    : t('accountingExportReadiness.periodOpen')
                  : undefined
              }
            />
          </section>

          {summary && summary.reasons.length > 0 ? (
            <div
              aria-label={t('accountingExportReadiness.blockerReasonsRegion')}
              className="flex flex-wrap gap-2 mb-6"
            >
              {summary.reasons.map((item) => {
                const selected = reason === item.code
                return (
                  <button
                    key={item.code}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setReason(selected ? '' : item.code)
                      resetToFirstPage()
                    }}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-sm transition-colors',
                      selected
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {t(`accountingExportReadiness.blockers.${item.code}`)}{' '}
                    <span className="tabular-nums">{item.documentCount}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {response && !response.exportProfile.canGenerate ? (
            <Alert className="mb-6">
              <AlertDescription>
                {response.exportProfile.configured
                  ? t('accountingExportReadiness.exportProfileDisabled')
                  : t('accountingExportReadiness.exportProfileMissing')}
              </AlertDescription>
            </Alert>
          ) : null}

          {tenantWideBlockers.length > 0 ? (
            <Alert className="mb-6">
              <AlertDescription>
                <p className="font-medium">
                  {t('accountingExportReadiness.tenantWideIssue', {
                    count: tenantWideBlockers.length,
                  })}
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
            searchPlaceholder={t('accountingExportReadiness.searchPlaceholder')}
            emptyStateMessage={t('accountingExportReadiness.emptyState')}
            rowBehaviour={{ onRowClick: (row) => navigate(row.href) }}
            {...tableState}
            setPagination={setPagination}
            setGlobalFilter={changeSearch}
          />
        </>
      )}
    </>
  )
}
