import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { CarFront } from 'lucide-react'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { useVehicles } from '@/api/vehicles'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'

type VehicleRow = {
  id: string
  vehicle: string
  year: number
  vin: string
  plate: string
  customer: string
}

function getCustomerLabel(customer?: {
  type: 'PRIVATE' | 'COMPANY'
  first_name: string
  last_name: string
  company_name?: string
} | null) {
  if (!customer) return 'Unassigned'
  if (customer.type === 'COMPANY' && customer.company_name) return customer.company_name
  return `${customer.first_name} ${customer.last_name}`.trim()
}

export default function VehicleList() {
  const navigate = useNavigate()
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading } = useVehicles(queryParams)

  const rows = useMemo<VehicleRow[]>(() => {
    return (responseData?.data ?? []).map((vehicle) => ({
      id: vehicle.id,
      vehicle: `${vehicle.make} ${vehicle.model}`,
      year: vehicle.year,
      vin: vehicle.vin || 'N/A',
      plate: vehicle.plate || 'N/A',
      customer: getCustomerLabel(vehicle.customer),
    }))
  }, [responseData])

  const columns: ColumnDef<VehicleRow>[] = [
    {
      id: 'icon',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='' className='w-[50px]' />
      ),
      cell: () => (
        <div className='w-[50px]'>
          <CarFront className='h-4 w-4 text-muted-foreground' />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'vehicle',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Vehicle' />,
      cell: ({ row }) => <span className='font-medium'>{row.original.vehicle}</span>,
    },
    {
      accessorKey: 'year',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Year' />,
    },
    {
      accessorKey: 'vin',
      header: ({ column }) => <DataTableColumnHeader column={column} title='VIN' />,
      cell: ({ row }) => <span className='text-xs'>{row.original.vin}</span>,
    },
    {
      accessorKey: 'plate',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Plate' />,
    },
    {
      accessorKey: 'customer',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Customer' />,
    },
  ]

  return (
    <div className='w-full max-w-7xl mx-auto p-6'>
      <div className='flex items-center justify-between mb-8'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>Vehicles</h1>
          <p className='text-slate-500'>Browse all vehicles and open full vehicle context.</p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        pageCount={responseData?.meta?.pageCount ?? 1}
        isLoading={isLoading}
        searchPlaceholder='Search vehicles...'
        onRowClick={(row) => navigate(`/vehicles/${row.id}`)}
        {...tableState}
      />
    </div>
  )
}

