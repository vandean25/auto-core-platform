import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { PAGE_HEADER_ROW } from '@/lib/page-header'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { useReadinessColumns } from './accounting-export-readiness-columns'
import {
  ReadinessFilters,
  ReadinessNotices,
  ReadinessSummary,
  ReasonChips,
} from './accounting-export-readiness-parts'
import { useAccountingExportReadinessState } from './useAccountingExportReadinessState'

export default function AccountingExportReadinessPage() {
  const { t } = useTranslation('finance')
  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  const navigate = useNavigate()
  const state = useAccountingExportReadinessState()
  const columns = useReadinessColumns()
  const { readiness, resetToFirstPage } = state
  const response = readiness.data

  return (
    <>
      <div className={PAGE_HEADER_ROW}>
        <div className="min-w-0 max-sm:w-full">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('accountingExportReadiness.title')}
          </h1>
          <p className="text-muted-foreground">{t('accountingExportReadiness.subtitle')}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate(`${APP_ROUTE_PATHS.settings}?tab=finance&subtab=accounting-export`)}
        >
          {t('actions.openSettings')}
        </Button>
      </div>

      <ReadinessFilters
        legalEntities={state.legalEntities}
        legalEntityId={state.legalEntityId}
        period={state.period}
        reason={state.reason}
        documentKind={state.documentKind}
        onEntityChange={(id) => {
          state.setSelectedEntityId(id)
          resetToFirstPage()
        }}
        onPeriodChange={(patch) => {
          state.setPeriod((current) => ({ ...current, ...patch }))
          resetToFirstPage()
        }}
        onReasonChange={(next) => {
          state.setReason(next)
          resetToFirstPage()
        }}
        onDocumentKindChange={(next) => {
          state.setDocumentKind(next)
          resetToFirstPage()
        }}
      />

      {!state.legalEntityId ? (
        <Empty>
          <EmptyDescription>{t('accountingExportReadiness.chooseLegalEntityHint')}</EmptyDescription>
        </Empty>
      ) : readiness.error ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{readiness.error.message}</AlertDescription>
        </Alert>
      ) : (
        <>
          <ReadinessSummary response={response} />
          <ReasonChips
            reasons={response?.summary.reasons ?? []}
            selectedReason={state.reason}
            onToggle={(next) => {
              state.setReason(next)
              resetToFirstPage()
            }}
          />
          <ReadinessNotices response={response} />

          <DataTable
            columns={columns}
            data={response?.data ?? []}
            pageCount={response?.meta.pageCount ?? 1}
            isLoading={readiness.isLoading}
            searchPlaceholder={t('accountingExportReadiness.searchPlaceholder')}
            emptyStateMessage={t('accountingExportReadiness.emptyState')}
            rowBehaviour={{ onRowClick: (row) => navigate(row.href) }}
            {...state.tableState}
            setPagination={state.setPagination}
            setGlobalFilter={state.changeSearch}
          />
        </>
      )}
    </>
  )
}
