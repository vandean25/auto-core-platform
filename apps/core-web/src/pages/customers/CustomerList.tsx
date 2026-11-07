import { useState, useEffect } from 'react'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useTranslation } from 'react-i18next'
import { useCustomers } from '@/api/customers'
import type { Customer } from '@/api/types'
import { Button } from '@/components/ui/button'
import { CustomerDialog } from '@/components/customers/CustomerDialog'
import { Plus } from 'lucide-react'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTable } from '@/components/data-table/DataTable'
import { PageHeader } from '@/components/layout/PageHeader'
import { useActionDialogParam } from '@/features/actions/use-action-dialog-param'
import { DASHBOARD_WIDGET_SOURCE_CUSTOMERS } from '@/features/dashboard-widgets/sources'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { CustomerPeekSheet } from '@/features/peek/CustomerPeekSheet'
import { usePeekSearchParam } from '@/features/peek/use-peek-search-param'
import { CustomerIconCell, CustomerNameCell } from './customer-list-cells'
import { useCustomerListRowBehaviour } from './useCustomerListRowBehaviour'
import { useCustomerPendingCreate } from './useCustomerPendingCreate'

export const CUSTOMER_CREATE_DIALOG_ACTION_IDS = ['create', 'customer.create'] as const

export default function CustomerList() {
  const { t } = useTranslation('customers')
  useEffect(() => {
    void ensureNamespaceLoaded('customers')
  }, [])
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, isLoading, isError, dataUpdatedAt } = useCustomers(queryParams)

  const customers: Customer[] = Array.isArray(responseData)
    ? responseData
    : responseData?.data || []
  const pending = useCustomerPendingCreate(customers, dataUpdatedAt)
  const pageCount = Array.isArray(responseData) ? 1 : responseData?.meta?.pageCount || 1

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>(undefined)
  const { open: isDialogOpen, onOpenChange: setIsDialogOpen } = useActionDialogParam(
    CUSTOMER_CREATE_DIALOG_ACTION_IDS,
  )

  const handleCreate = () => {
    setSelectedCustomer(undefined)
    setIsDialogOpen(true)
  }

  const peek = usePeekSearchParam()
  const rowBehaviour = useCustomerListRowBehaviour(peek.openPeek, customers)

  const columns: ColumnDef<Customer>[] = [
    {
      id: 'icon',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="" className="w-[50px]" />
      ),
      cell: ({ row }) => (
        <div className="w-[50px]">
          <CustomerIconCell customer={row.original} />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'company_name',
      meta: { mobile: 'title' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('list.columns.name')} />
      ),
      cell: ({ row }) => <CustomerNameCell customer={row.original} onDismiss={pending.dismiss} />,
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
      meta: { mobile: 'subtitle' },
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
        data={pending.rows}
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
        rowBehaviour={rowBehaviour}
        {...tableState}
      />

      <CustomerDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        customer={selectedCustomer}
        onCreate={pending.submit}
      />
      <CustomerPeekSheet
        peekId={peek.peekId}
        isPeekOpen={peek.isPeekOpen}
        closePeek={peek.closePeek}
      />
    </>
  )
}
