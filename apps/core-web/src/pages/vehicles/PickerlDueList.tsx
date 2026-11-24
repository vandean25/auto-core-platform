import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { usePickerlDueList } from '@/api/vehicles'
import { triggerBlobDownload } from '@/lib/download'
import { fetchWithAuth } from '@/api/client'
import { RecordPickerlDialog } from '@/components/vehicles/RecordPickerlDialog'
import { RecordPickerlContactDialog } from '@/components/vehicles/RecordPickerlContactDialog'
import { PickerlDueFilters } from '@/components/vehicles/PickerlDueFilters'
import {
  buildPickerlDueColumns,
  buildPickerlDueQueryParams,
  mapPickerlDueRow,
  type PickerlDueRow,
} from '@/components/vehicles/pickerl-due-columns'
import { WorkshopOrderIntakeDialog } from '@/components/workshop/WorkshopOrderIntakeDialog'
import { useAuthSession } from '@/api/auth-session'
import { MAX_VEHICLE_LIST_PAGE_SIZE, VEHICLE_LIST_PAGE_SIZE_OPTIONS } from '@/lib/list-page-size'
import { canRecordVehicleInspection } from '@/components/vehicles/vehicle-pickerl-permissions'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { PageHeader } from '@/components/layout/PageHeader'
import { offsetListTableProps } from '@/components/data-table/offset-list-table-props'

function matchesClientSearch(row: PickerlDueRow, term: string): boolean {
  const haystack = [row.plate, row.vehicle, row.customer, row.phone, row.email]
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

export default function PickerlDueList() {
  const { t } = useTranslation('vehicles')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicles')
  }, [])
  const navigate = useNavigate()
  const emDash = t('shared.emDash')
  const sessionQuery = useAuthSession()
  const canManagePickerl = canRecordVehicleInspection(sessionQuery.data?.activeRole)
  const {
    queryParams: tableQueryParams,
    columnFilters,
    setColumnFilters,
    setPagination,
    globalFilter,
    setGlobalFilter,
    ...tableState
  } = useDataTableQuery({
    defaultPageSize: 25,
    maxPageSize: MAX_VEHICLE_LIST_PAGE_SIZE,
    initialSorting: [],
  })

  const queryParams = buildPickerlDueQueryParams(tableQueryParams, columnFilters)
  const pickerlQuery = usePickerlDueList(queryParams)
  const { data: responseData, isLoading } = pickerlQuery

  const [recordPickerlVehicleId, setRecordPickerlVehicleId] = useState<string | null>(null)
  const [intakeVehicleId, setIntakeVehicleId] = useState<string | null>(null)
  const [contactVehicle, setContactVehicle] = useState<PickerlDueRow | null>(null)

  const rows = useMemo<PickerlDueRow[]>(
    () => (responseData?.data ?? []).map((vehicle) => mapPickerlDueRow(vehicle, emDash)),
    [emDash, responseData?.data],
  )

  const filteredRows = useMemo(() => {
    const term = globalFilter.trim().toLowerCase()
    return term ? rows.filter((row) => matchesClientSearch(row, term)) : rows
  }, [rows, globalFilter])

  const exportDueCsv = async () => {
    const searchParams = new URLSearchParams()
    if (queryParams.window) searchParams.set('window', queryParams.window.toString())
    if (queryParams.status) searchParams.set('status', queryParams.status)
    if (queryParams.contacted) searchParams.set('contacted', queryParams.contacted)
    if (queryParams.contactedDays) {
      searchParams.set('contactedDays', queryParams.contactedDays.toString())
    }

    const response = await fetchWithAuth(
      `/api/vehicles/pickerl-due/export?${searchParams.toString()}`,
    )
    if (!response.ok) {
      toast.error(t('pickerlDue.exportFailed'))
      return
    }
    const text = await response.text()
    triggerBlobDownload(new Blob([text], { type: 'text/csv' }), 'pickerl-due.csv')
  }

  const columns = useMemo(
    () =>
      buildPickerlDueColumns({
        t,
        emDash,
        canManagePickerl,
        onRecordContact: setContactVehicle,
        onRecordPickerl: setRecordPickerlVehicleId,
        onOpenOrder: (orderId) => navigate(`/workshop/orders/${orderId}`),
        onCreateOrder: setIntakeVehicleId,
      }),
    [canManagePickerl, emDash, navigate, t],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        title={t('pickerlDue.title')}
        description={t('pickerlDue.description')}
        actions={
          <Button
            variant="outline"
            size="lg"
            className="min-h-11"
            onClick={() => void exportDueCsv()}
          >
            <Download className="mr-2 h-4 w-4" />
            {t('pickerlDue.exportCsv')}
          </Button>
        }
      />

      <PickerlDueFilters
        window={queryParams.window}
        status={queryParams.status}
        contacted={queryParams.contacted}
        contactedDays={queryParams.contactedDays}
        setColumnFilters={setColumnFilters}
        resetPage={() => setPagination((current) => ({ ...current, pageIndex: 0 }))}
      />

      <DataTable
        columns={columns}
        data={filteredRows}
        isLoading={isLoading}
        isFetching={pickerlQuery.isFetching}
        isError={pickerlQuery.isError}
        hasUsableData={responseData !== undefined}
        {...offsetListTableProps(pickerlQuery)}
        pageCount={responseData?.meta.pageCount ?? 0}
        pageSizeOptions={VEHICLE_LIST_PAGE_SIZE_OPTIONS}
        enableCsvExport={false}
        rowBehaviour={{
          getRowAccessibleName: (row) => t('pickerlDue.vehicleRowAria', { plate: row.plate }),
          onRowClick: (row) => navigate(`/vehicles/${row.id}`),
          getRowContextActions: canManagePickerl
            ? () => [
                {
                  id: ENTITY_ACTION_IDS.vehiclePickerlContact,
                  label: t('pickerlDue.recordContact'),
                  onClick: (target) => setContactVehicle(target),
                },
              ]
            : undefined,
        }}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        setPagination={setPagination}
        globalFilter={globalFilter}
        setGlobalFilter={setGlobalFilter}
        searchPlaceholder={t('pickerlDue.searchLoadedRows')}
        {...tableState}
      />

      {recordPickerlVehicleId && (
        <RecordPickerlDialog
          vehicleId={recordPickerlVehicleId}
          open={!!recordPickerlVehicleId}
          onOpenChange={(open) => !open && setRecordPickerlVehicleId(null)}
        />
      )}

      {intakeVehicleId && (
        <WorkshopOrderIntakeDialog
          open={!!intakeVehicleId}
          onOpenChange={(open) => !open && setIntakeVehicleId(null)}
          initialVehicleId={intakeVehicleId}
          pickerlMode
        />
      )}

      {contactVehicle && (
        <RecordPickerlContactDialog
          vehicleId={contactVehicle.id}
          plate={contactVehicle.plate}
          phoneConsentAllowed={contactVehicle.phoneConsentAllowed}
          open={!!contactVehicle}
          onOpenChange={(open) => !open && setContactVehicle(null)}
        />
      )}
    </div>
  )
}
