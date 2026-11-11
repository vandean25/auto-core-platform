import { useState } from 'react'
import { Plus } from 'lucide-react'
import { DataTable } from '@/components/data-table/DataTable'
import { DASHBOARD_WIDGET_SOURCE_VEHICLES } from '@/features/dashboard-widgets/sources'
import { Button } from '@/components/ui/button'
import { VehicleDialog } from '@/components/vehicles/VehicleDialog'
import { VEHICLE_LIST_PAGE_SIZE_OPTIONS } from '@/lib/list-page-size'
import { VehiclePeekSheet } from '@/features/peek/VehiclePeekSheet'
import { useVehicleListPage } from './useVehicleListPage'
import { PAGE_HEADER_ROW } from '@/lib/page-header'

export default function VehicleList() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const {
    t,
    vehiclesQuery,
    responseData,
    listSettled,
    tableState,
    pending,
    columns,
    rowBehaviour,
    peek,
  } = useVehicleListPage()

  return (
    <>
      <div className={PAGE_HEADER_ROW}>
        <div className="min-w-0 max-sm:w-full">
          <h1 className="text-2xl font-semibold tracking-tight">{t('list.title')}</h1>
          <p className="text-muted-foreground">{t('list.description')}</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> {t('list.addVehicle')}
        </Button>
      </div>

      <VehicleDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} onCreate={pending.submit} />

      <DataTable
        columns={columns}
        data={pending.rows}
        saveViewTitle={t('list.saveViewTitle')}
        dashboardSource={DASHBOARD_WIDGET_SOURCE_VEHICLES}
        pageCount={responseData?.meta?.pageCount ?? 1}
        pageSizeOptions={VEHICLE_LIST_PAGE_SIZE_OPTIONS}
        isLoading={vehiclesQuery.isPending && vehiclesQuery.isFetching}
        isPending={vehiclesQuery.isPending}
        isFetching={vehiclesQuery.isFetching}
        hasUsableData={listSettled}
        listSnapshotResolved={listSettled}
        searchPlaceholder={t('list.searchPlaceholder')}
        rowBehaviour={rowBehaviour}
        {...tableState}
      />
      <VehiclePeekSheet
        peekId={peek.peekId}
        isPeekOpen={peek.isPeekOpen}
        closePeek={peek.closePeek}
      />
    </>
  )
}
