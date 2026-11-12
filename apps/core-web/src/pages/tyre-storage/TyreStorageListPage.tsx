import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Download, Plus } from 'lucide-react'
import { DataTable } from '@/components/data-table/DataTable'
import { Button } from '@/components/ui/button'
import { fetchWithAuth } from '@/api/client'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { triggerBlobDownload } from '@/lib/download'
import { TyreSetFormDialog } from '@/features/tyre-storage/TyreSetFormDialog'
import { toast } from 'sonner'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { createTyreStorageListColumns } from '@/features/tyre-storage/tyre-storage-list-columns'
import {
  exportDueTyreSetsCsv,
  tyreStorageExportFailedMessage,
} from '@/features/tyre-storage/tyre-storage-list-export'
import { TyreStorageListFilters } from '@/features/tyre-storage/TyreStorageListFilters'
import { useTyreStorageListPage } from './useTyreStorageListPage'

export default function TyreStorageListPage() {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const navigate = useNavigate()
  const emDash = t('shared.emDash')
  const {
    search,
    setSearch,
    viewMode,
    setViewMode,
    season,
    setSeason,
    status,
    setStatus,
    locationId,
    setLocationId,
    customerFilter,
    setCustomerFilter,
    dueFrom,
    setDueFrom,
    dueTo,
    setDueTo,
    createOpen,
    setCreateOpen,
    storageLocations,
    rows,
    isLoading,
    tableState,
    pageCount,
    pageSizeOptions,
    dueCount,
  } = useTyreStorageListPage()

  const columns = useMemo(
    () => createTyreStorageListColumns({ t, emDash, viewMode }),
    [emDash, viewMode, t],
  )

  const exportDueCsv = useCallback(async () => {
    await exportDueTyreSetsCsv(
      {
        fetchExport: () => fetchWithAuth('/api/tyre-sets/due-for-swap/export'),
        downloadBlob: triggerBlobDownload,
        showExportFailed: (message) => toast.error(message),
      },
      tyreStorageExportFailedMessage(t),
    )
  }, [t])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('tyreStorage.list.title')}</h1>
          <p className="text-muted-foreground">{t('tyreStorage.list.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" className="min-h-11" onClick={() => void exportDueCsv()}>
            <Download className="mr-2 h-4 w-4" />
            {t('actions.exportDueCsv')}
          </Button>
          <Button
            size="lg"
            className="min-h-11"
            onClick={() => {
              if (!customerFilter?.id) {
                toast.error(t('tyreStorage.list.selectCustomerToCreate'))
                return
              }
              setCreateOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('actions.tyreSet')}
          </Button>
        </div>
      </div>

      <TyreStorageListFilters
        viewMode={viewMode}
        search={search}
        onSearchChange={setSearch}
        season={season}
        onSeasonChange={setSeason}
        status={status}
        onStatusChange={setStatus}
        locationId={locationId}
        onLocationIdChange={setLocationId}
        customerFilter={customerFilter}
        onCustomerFilterChange={setCustomerFilter}
        dueFrom={dueFrom}
        onDueFromChange={setDueFrom}
        dueTo={dueTo}
        onDueToChange={setDueTo}
        storageLocations={storageLocations}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant={viewMode === 'all' ? 'default' : 'outline'}
          className="min-h-11"
          onClick={() => setViewMode('all')}
        >
          {t('actions.allSets')}
        </Button>
        <Button
          variant={viewMode === 'due' ? 'default' : 'outline'}
          className="min-h-11"
          onClick={() => setViewMode('due')}
        >
          {t('tyreStorage.list.dueCount', { count: dueCount })}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowBehaviour={{
          onRowClick: (row) => navigate(APP_ROUTE_PATHS.tyreStorageDetail.replace(':id', row.id)),
        }}
        {...tableState}
        pageCount={pageCount}
        pageSizeOptions={pageSizeOptions}
        enableCsvExport={false}
      />

      <TyreSetFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        customerId={customerFilter?.id ?? ''}
      />
    </div>
  )
}
