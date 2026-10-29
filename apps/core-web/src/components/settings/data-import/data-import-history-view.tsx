import { useTranslation } from 'react-i18next'

import { DataTable } from '@/components/data-table/DataTable'
import { Alert, AlertDescription } from '@/components/ui/alert'

import { useDataImportHistory } from './use-data-import-history'

/** Read-only history of this tenant's imports; opening a row resumes it in the wizard. */
export function DataImportHistoryView({ onOpenJob }: { onOpenJob: (jobId: string) => void }) {
  const { t } = useTranslation('settings')
  const history = useDataImportHistory(onOpenJob)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-medium">{t('dataImport.history.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('dataImport.history.description')}</p>
      </div>

      {history.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('dataImport.history.loadFailed')}</AlertDescription>
        </Alert>
      ) : null}

      <DataTable
        columns={history.columns}
        data={history.rows}
        pageCount={history.pageCount}
        isLoading={history.isLoading}
        columnFilters={history.columnFilters}
        setColumnFilters={history.setColumnFilters}
        sorting={history.sorting}
        setSorting={history.setSorting}
        pagination={history.pagination}
        setPagination={history.setPagination}
        rowBehaviour={history.rowBehaviour}
        enableCsvExport={false}
        emptyState={history.isError ? undefined : { message: t('dataImport.history.empty') }}
      />
    </div>
  )
}
