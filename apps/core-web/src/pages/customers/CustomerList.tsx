import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useTranslation } from 'react-i18next'
import { useCustomers, useDeleteCustomer } from '@/api/customers'
import type { Customer } from '@/api/types'
import { Button } from '@/components/ui/button'
import { CustomerDialog } from '@/components/customers/CustomerDialog'
import { Plus, User, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTable } from '@/components/data-table/DataTable'
import { PageHeader } from '@/components/layout/PageHeader'
import { DASHBOARD_WIDGET_SOURCE_CUSTOMERS } from '@/features/dashboard-widgets/sources'
import { getErrorMessage } from '@/lib/error-utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'

export default function CustomerList() {
  const { t } = useTranslation('customers')
  useEffect(() => {
    void ensureNamespaceLoaded('customers')
  }, [])
  const navigate = useNavigate()
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading, isError } = useCustomers(queryParams)
  const [searchParams, setSearchParams] = useSearchParams()

  const customers: Customer[] = Array.isArray(responseData)
    ? responseData
    : responseData?.data || []
  const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount || 1

  const deleteMutation = useDeleteCustomer()
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>(undefined)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  useEffect(() => {
    if (searchParams.get('action') === 'create') {
      setTimeout(() => {
        setSelectedCustomer(undefined)
        setIsDialogOpen(true)

        const newParams = new URLSearchParams(searchParams)
        newParams.delete('action')
        setSearchParams(newParams, { replace: true })
      }, 0)
    }
  }, [searchParams, setSearchParams])

  const handleDelete = async (id: string) => {
    if (!confirm(t('list.deleteConfirm'))) return
    try {
      await deleteMutation.mutateAsync(id)
      toast.success(t('list.deleted'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('list.deleteFailed')))
    }
  }

  const handleCreate = () => {
    setSelectedCustomer(undefined)
    setIsDialogOpen(true)
  }

  const columns: ColumnDef<Customer>[] = [
    {
      id: 'icon',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="" className="w-[50px]" />
      ),
      cell: ({ row }) => (
        <div className="w-[50px]">
          {row.original.type === 'COMPANY' ? (
            <Building2 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <User className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'company_name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('list.columns.name')} />
      ),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            {row.original.type === 'COMPANY'
              ? row.original.company_name
              : `${row.original.first_name} ${row.original.last_name}`}
          </div>
          {row.original.type === 'COMPANY' && (
            <div className="text-xs text-muted-foreground">
              {row.original.first_name} {row.original.last_name}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('list.columns.contact')} />
      ),
      cell: ({ row }) => (
        <div className="flex flex-col text-sm">
          <span>{row.original.email}</span>
          <span className="text-muted-foreground">{row.original.phone}</span>
        </div>
      ),
    },
    {
      accessorKey: 'address_city',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('list.columns.location')} />
      ),
      cell: ({ row }) => (
        <div className="text-sm">
          {row.original.address_city} {row.original.address_country}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" /> {t('list.addCustomer')}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={customers}
        saveViewTitle={t('list.saveViewTitle')}
        dashboardSource={DASHBOARD_WIDGET_SOURCE_CUSTOMERS}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder={t('list.searchPlaceholder')}
        emptyState={
          isError
            ? undefined
            : {
                message: t('list.empty'),
                action: (
                  <Button onClick={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" /> {t('list.emptyAction')}
                  </Button>
                ),
              }
        }
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        getRowContextActions={(row) => [
          {
            label: t('list.delete'),
            onClick: () => void handleDelete(row.id),
            destructive: true,
          },
        ]}
        {...tableState}
      />

      <CustomerDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        customer={selectedCustomer}
      />
    </>
  )
}
