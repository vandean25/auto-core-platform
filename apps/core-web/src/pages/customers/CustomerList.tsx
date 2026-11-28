import { useState, useEffect } from 'react'
import { type LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useTranslation } from 'react-i18next'
import { useCustomerListState } from '@/api/customer-list'
import type { Customer } from '@/api/types'
import { Button } from '@/components/ui/button'
import { CustomerDialog } from '@/components/customers/CustomerDialog'
import { CustomFieldListFilters } from '@/components/custom-fields/CustomFieldListFilters'
import { useCustomFieldList } from '@/components/custom-fields/use-custom-field-list'
import { Plus } from 'lucide-react'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTable } from '@/components/data-table/DataTable'
import { PageHeader } from '@/components/layout/PageHeader'
import { useActionDialogParam } from '@/features/actions/use-action-dialog-param'
import { DASHBOARD_WIDGET_SOURCE_CUSTOMERS } from '@/features/dashboard-widgets/sources'
import { useIsMobile } from '@/hooks/use-mobile'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { CustomerPeekSheet } from '@/features/peek/CustomerPeekSheet'
import { usePeekSearchParam } from '@/features/peek/use-peek-search-param'
import { CustomerIconCell, CustomerNameCell } from './customer-list-cells'
import { useCustomerListRowBehaviour } from './useCustomerListRowBehaviour'
import { useCustomerPendingCreate } from './useCustomerPendingCreate'

export const CUSTOMER_CREATE_DIALOG_ACTION_IDS = ['create', 'customer.create'] as const

export default function CustomerList() {
  const { t } = useTranslation('customers')
  const isMobile = useIsMobile()
  useEffect(() => {
    void ensureNamespaceLoaded('customers')
  }, [])
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const customFields = useCustomFieldList<Customer>('CUSTOMER')
  const list = useCustomerListState(queryParams, customFields.params)

  const customers = list.customers
  const pending = useCustomerPendingCreate(customers, list.dataUpdatedAt)

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
      id: 'company_name',
      accessorFn: (customer) => [customer.company_name, customer.first_name, customer.last_name].filter(Boolean).join(' '),
      meta: { mobile: 'title' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('list.columns.name')} />
      ),
      cell: ({ row }) => <CustomerNameCell customer={row.original} onDismiss={pending.dismiss} />,
    },
    {
      id: 'email',
      accessorFn: (customer) => [customer.email, customer.phone].filter(Boolean).join(' '),
      meta: { mobile: 'details' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('list.columns.contact')} />
      ),
      cell: ({ row }) => {
        const phone = row.original.phone?.trim()
        return (
          <div className="flex min-w-0 flex-col text-sm">
            <span className="min-w-0 break-all">{row.original.email}</span>
            {phone ? (
              isMobile ? (
                <a
                  href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                  className="inline-flex min-h-11 min-w-11 max-w-full items-center text-muted-foreground"
                >
                  {phone}
                </a>
              ) : (
                <span className="text-muted-foreground">{phone}</span>
              )
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'address_city',
      accessorFn: (customer) => [customer.address_city, customer.address_country].filter(Boolean).join(' '),
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
    ...customFields.columns,
  ]

  return (
    <>
      <PageHeader
        title={t('list.title')}
        actions={
          <Button className="max-sm:min-h-11" onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" /> {t('list.addCustomer')}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={pending.rows}
        saveViewTitle={t('list.saveViewTitle')}
        dashboardSource={DASHBOARD_WIDGET_SOURCE_CUSTOMERS}
        enableMobileCsvExport={customFields.definitions.length > 0}
        toolbarFilters={<CustomFieldListFilters definitions={customFields.definitions} filters={customFields.filters} onApply={customFields.apply} />}
        {...list.tableProps}
        searchPlaceholder={t('list.searchPlaceholder')}
        emptyState={
          list.isError
            ? undefined
            : {
                message: t('list.empty'),
                action: (
                  <Button className="max-sm:min-h-11" onClick={handleCreate}>
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
