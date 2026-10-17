import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCustomer, useUpdateCustomer } from '@/api/customers'
import { formatDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { StartServiceDialog } from '@/components/workshop/StartServiceDialog'
import { TyreSetsSummary } from '@/features/tyre-storage/TyreSetsSummary'
import { usePageBreadcrumbs } from '@/hooks/usePageBreadcrumbs'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Phone, Mail, MapPin, ArrowLeft, Package, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { CustomerConsentPanel } from './CustomerConsentPanel'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import type {
  Customer,
  InvoiceStatus,
  NormalizedWorkshopTaskLineItem,
  SalesOrderStatus,
  Vehicle,
  WorkshopOrderStatus,
} from '@/api/types'

type SalesOrderSummary = {
  id: string
  order_number: string
  status: SalesOrderStatus
  total_amount: string | number
  createdAt: string
}

type WorkshopLineItemSummary = Pick<NormalizedWorkshopTaskLineItem, 'quantity' | 'unitPrice'>

type WorkshopTaskSummary = {
  lineItems?: WorkshopLineItemSummary[]
}

type WorkshopOrderSummary = {
  id: string
  order_number?: string
  status: WorkshopOrderStatus
  createdAt: string
  vehicle_id?: string
  tasks?: WorkshopTaskSummary[]
  vehicle?: Vehicle | null
}

type InvoiceSummary = {
  id: string
  invoice_number: string | null
  status: InvoiceStatus
  date: string
  total_gross: string | number
}

type CustomerDetailResponse = Customer & {
  sales_orders?: SalesOrderSummary[]
  workshop_orders?: WorkshopOrderSummary[]
  invoices?: InvoiceSummary[]
  vehicles?: Vehicle[]
}

type ActiveOrderRow = {
  id: string
  type: 'Sales' | 'Service'
  number: string
  createdAt: string
  status: SalesOrderStatus | WorkshopOrderStatus
  total: number
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function getWorkshopOrderTotal(order: WorkshopOrderSummary) {
  return (order.tasks ?? []).reduce((taskSum, task) => {
    const lineItems = task.lineItems ?? []
    const taskTotal = lineItems.reduce(
      (lineSum, line) => lineSum + toNumber(line.quantity) * toNumber(line.unitPrice),
      0,
    )
    return taskSum + taskTotal
  }, 0)
}

function getCustomerDisplayName(customer: Pick<Customer, 'type' | 'company_name' | 'first_name' | 'last_name'>) {
  return customer.type === 'COMPANY' ? customer.company_name : `${customer.first_name} ${customer.last_name}`
}

export default function CustomerDetail() {
  const { t } = useTranslation('customers')
  useEffect(() => {
    void ensureNamespaceLoaded('customers')
  }, [])
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data: customer, isLoading, error } = useCustomer<CustomerDetailResponse>(id ?? '')
  const updateCustomer = useUpdateCustomer()
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false)
  const [selectedWorkshopVehicle, setSelectedWorkshopVehicle] = useState<Vehicle | null>(null)
  const customerName = customer ? getCustomerDisplayName(customer) : undefined
  usePageBreadcrumbs({
    listPath: APP_ROUTE_PATHS.customers,
    currentLabel: customerName || t('detail.breadcrumbFallback'),
  })

  const notAvailable = t('detail.notAvailable')

  if (isLoading) {
    return <div className='p-8 text-center'>{t('detail.loading')}</div>
  }

  if (error) {
    return (
      <div className='p-8 text-center'>
        {t('detail.loadFailed', { message: (error as Error).message })}
      </div>
    )
  }

  if (!customer) {
    return <div className='p-8 text-center'>{t('detail.notFound')}</div>
  }

  const orderTypeLabel = (type: ActiveOrderRow['type']) =>
    t(type === 'Sales' ? 'detail.orderTypes.sales' : 'detail.orderTypes.service')

  const salesActive: ActiveOrderRow[] = (customer.sales_orders ?? [])
    .filter((order) => order.status !== 'INVOICED')
    .map((order) => ({
      id: order.id,
      type: 'Sales',
      number: order.order_number || `#${order.id.slice(0, 8)}`,
      createdAt: order.createdAt,
      status: order.status,
      total: toNumber(order.total_amount),
    }))

  const workshopActive: ActiveOrderRow[] = (customer.workshop_orders ?? [])
    .filter((order) => order.status !== 'INVOICED')
    .map((order) => ({
      id: order.id,
      type: 'Service',
      number: order.order_number ?? `#${order.id}`,
      createdAt: order.createdAt,
      status: order.status,
      total: getWorkshopOrderTotal(order),
    }))

  const activeOrders = [...salesActive, ...workshopActive].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  type EditableCustomerField =
    | 'company_name'
    | 'first_name'
    | 'last_name'
    | 'email'
    | 'phone'
    | 'vat_id'
    | 'address_street'
    | 'address_zip'
    | 'address_city'
    | 'address_country'

  const handleSaveCustomerField = async (
    field: EditableCustomerField,
    nextValue: string,
  ) => {
    try {
      await updateCustomer.mutateAsync({
        id: customer.id,
        data: {
          [field]: nextValue,
        },
      })
      toast.success(t('detail.updated'))
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast.error(error.message)
      } else {
        toast.error(t('detail.updateFailed'))
      }
      throw error
    }
  }

  const customerVehicles = customer.vehicles ?? []

  const getVehicleDescription = (vehicle: Vehicle) => {
    const base = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    return vehicle.plate ? `${base} (${vehicle.plate})` : base
  }

  const handleCreateWorkshopOrder = () => {
    if (customerVehicles.length === 0) {
      toast.error(t('detail.noVehicleForService'))
      return
    }

    if (customerVehicles.length === 1) {
      setSelectedWorkshopVehicle(customerVehicles[0])
      return
    }

    setVehiclePickerOpen(true)
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div className='flex items-center gap-4'>
          <Button variant='ghost' size='icon' asChild>
            <Link to='/customers' aria-label={t('detail.backAria')}>
              <ArrowLeft className='h-4 w-4' />
            </Link>
          </Button>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {getCustomerDisplayName(customer)}
            </h1>
            <div className='flex items-center gap-2 text-slate-500 text-sm'>
              {customer.type === 'COMPANY' && <Badge variant='outline'>{t('detail.companyBadge')}</Badge>}
              <span>{t('detail.idLabel', { id: customer.id.substring(0, 8) })}</span>
            </div>
          </div>
        </div>
        <div className='flex flex-col items-end gap-2'>
          <div className='flex flex-wrap justify-end gap-2'>
            <Button asChild>
              <Link to={`/sales-orders/new?customerId=${customer.id}`}>
                <Package className='mr-2 h-4 w-4' /> {t('detail.newSalesOrder')}
              </Link>
            </Button>
            <Button variant='outline' onClick={handleCreateWorkshopOrder}>
              <Wrench className='mr-2 h-4 w-4' /> {t('detail.startService')}
            </Button>
          </div>
          <p className='text-xs text-slate-500'>{t('detail.invoiceHint')}</p>
        </div>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <Card className='lg:col-span-1'>
          <CardHeader>
            <CardTitle className='text-base font-semibold'>{t('detail.contactInformation')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {customer.type === 'COMPANY' ? (
              <div className='space-y-2'>
                <div>
                  <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.companyName')}</div>
                  <InlineEdit
                    value={customer.company_name}
                    onSave={(nextValue) => handleSaveCustomerField('company_name', nextValue)}
                    placeholder={t('detail.placeholders.companyName')}
                    emptyText={t('detail.empty.companyName')}
                    ariaLabel={t('detail.aria.companyName')}
                  />
                </div>
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                  <div>
                    <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.contactFirstName')}</div>
                    <InlineEdit
                      value={customer.first_name}
                      onSave={(nextValue) => handleSaveCustomerField('first_name', nextValue)}
                      placeholder={t('detail.placeholders.firstName')}
                      emptyText={t('detail.empty.firstName')}
                      ariaLabel={t('detail.aria.contactFirstName')}
                    />
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.contactLastName')}</div>
                    <InlineEdit
                      value={customer.last_name}
                      onSave={(nextValue) => handleSaveCustomerField('last_name', nextValue)}
                      placeholder={t('detail.placeholders.lastName')}
                      emptyText={t('detail.empty.lastName')}
                      ariaLabel={t('detail.aria.contactLastName')}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                <div>
                  <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.firstName')}</div>
                  <InlineEdit
                    value={customer.first_name}
                    onSave={(nextValue) => handleSaveCustomerField('first_name', nextValue)}
                    placeholder={t('detail.placeholders.firstName')}
                    emptyText={t('detail.empty.firstName')}
                    ariaLabel={t('detail.aria.firstName')}
                  />
                </div>
                <div>
                  <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.lastName')}</div>
                  <InlineEdit
                    value={customer.last_name}
                    onSave={(nextValue) => handleSaveCustomerField('last_name', nextValue)}
                    placeholder={t('detail.placeholders.lastName')}
                    emptyText={t('detail.empty.lastName')}
                    ariaLabel={t('detail.aria.lastName')}
                  />
                </div>
              </div>
            )}

            <div className='flex items-center gap-2'>
              <Mail className='h-4 w-4 text-muted-foreground' />
              <InlineEdit
                value={customer.email}
                onSave={(nextValue) => handleSaveCustomerField('email', nextValue)}
                placeholder={t('detail.placeholders.email')}
                emptyText={t('detail.empty.email')}
                ariaLabel={t('detail.aria.email')}
              />
            </div>
            <div className='flex items-center gap-2'>
              <Phone className='h-4 w-4 text-muted-foreground' />
              <InlineEdit
                value={customer.phone}
                onSave={(nextValue) => handleSaveCustomerField('phone', nextValue)}
                placeholder={t('detail.placeholders.phone')}
                emptyText={t('detail.empty.phone')}
                ariaLabel={t('detail.aria.phone')}
              />
            </div>
            <TyreSetsSummary customerId={customer.id} />
            <div className='flex items-start gap-2'>
              <MapPin className='h-4 w-4 text-muted-foreground mt-1' />
              <div className='w-full space-y-1'>
                <InlineEdit
                  mode='textarea'
                  rows={3}
                  value={customer.address_street}
                  onSave={(nextValue) => handleSaveCustomerField('address_street', nextValue)}
                  placeholder={t('detail.placeholders.street')}
                  emptyText={t('detail.empty.street')}
                  ariaLabel={t('detail.aria.street')}
                />
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                  <InlineEdit
                    value={customer.address_zip}
                    onSave={(nextValue) => handleSaveCustomerField('address_zip', nextValue)}
                    placeholder={t('detail.placeholders.zip')}
                    emptyText={t('detail.empty.zip')}
                    ariaLabel={t('detail.aria.zip')}
                  />
                  <InlineEdit
                    value={customer.address_city}
                    onSave={(nextValue) => handleSaveCustomerField('address_city', nextValue)}
                    placeholder={t('detail.placeholders.city')}
                    emptyText={t('detail.empty.city')}
                    ariaLabel={t('detail.aria.city')}
                  />
                </div>
                <InlineEdit
                  value={customer.address_country}
                  onSave={(nextValue) => handleSaveCustomerField('address_country', nextValue)}
                  placeholder={t('detail.placeholders.country')}
                  emptyText={t('detail.empty.country')}
                  ariaLabel={t('detail.aria.country')}
                />
              </div>
            </div>
            <div className='pt-2 border-t'>
              <span className='text-sm font-medium'>{t('detail.fields.vatId')}:</span>
              <div className='mt-1'>
                <InlineEdit
                  value={customer.vat_id}
                  onSave={(nextValue) => handleSaveCustomerField('vat_id', nextValue)}
                  placeholder={t('detail.placeholders.vatId')}
                  emptyText={t('detail.empty.vatId')}
                  ariaLabel={t('detail.aria.vatId')}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className='lg:col-span-2'>
          <Tabs defaultValue='orders'>
            <TabsList className='flex h-auto min-h-9 w-full flex-wrap gap-1'>
              <TabsTrigger value='orders'>{t('detail.tabs.activeOrders')}</TabsTrigger>
              <TabsTrigger value='invoices'>{t('detail.tabs.invoices')}</TabsTrigger>
              <TabsTrigger value='vehicles'>{t('detail.tabs.vehicles')}</TabsTrigger>
              <TabsTrigger value='consent'>{t('consent.tab')}</TabsTrigger>
            </TabsList>

            <TabsContent value='orders' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('detail.tables.orderNumber')}</TableHead>
                        <TableHead>{t('detail.tables.type')}</TableHead>
                        <TableHead>{t('detail.tables.date')}</TableHead>
                        <TableHead>{t('detail.tables.status')}</TableHead>
                        <TableHead className='text-right'>{t('detail.tables.total')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeOrders.map((order) => (
                        <TableRow
                          key={`${order.type}-${order.id}`}
                          className='cursor-pointer hover:bg-accent/50'
                          onClick={() =>
                            navigate(order.type === 'Service' ? `/workshop/orders/${order.id}` : `/sales-orders/${order.id}`)
                          }
                          tabIndex={0}
                          role='button'
                          aria-label={
                            order.type === 'Service'
                              ? t('detail.aria.openServiceOrder', { number: order.number })
                              : t('detail.aria.openSalesOrder', { number: order.number })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(order.type === 'Service' ? `/workshop/orders/${order.id}` : `/sales-orders/${order.id}`)
                            }
                          }}
                        >
                          <TableCell className='font-medium'>{order.number}</TableCell>
                          <TableCell>{orderTypeLabel(order.type)}</TableCell>
                          <TableCell>{formatDate(order.createdAt)}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(order.total)}</TableCell>
                        </TableRow>
                      ))}
                      {activeOrders.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className='text-center py-4 text-muted-foreground'>{t('detail.tables.noActiveOrders')}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='invoices' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('detail.tables.invoiceNumber')}</TableHead>
                        <TableHead>{t('detail.tables.date')}</TableHead>
                        <TableHead>{t('detail.tables.status')}</TableHead>
                        <TableHead className='text-right'>{t('detail.tables.total')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(customer.invoices ?? []).map((invoice) => (
                        <TableRow
                          key={invoice.id}
                          className='cursor-pointer hover:bg-accent/50'
                          onClick={() => navigate(`/sales/invoices/${invoice.id}`)}
                          tabIndex={0}
                          role='button'
                          aria-label={t('detail.aria.openInvoice', {
                            number: invoice.invoice_number || invoice.id,
                          })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(`/sales/invoices/${invoice.id}`)
                            }
                          }}
                        >
                          <TableCell className='font-medium'>{invoice.invoice_number || t('detail.tables.invoiceDraft')}</TableCell>
                          <TableCell>{formatDate(invoice.date)}</TableCell>
                          <TableCell><StatusBadge status={invoice.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(toNumber(invoice.total_gross))}</TableCell>
                        </TableRow>
                      ))}
                      {(customer.invoices ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>{t('detail.tables.noRecentInvoices')}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='vehicles' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('detail.tables.makeModel')}</TableHead>
                        <TableHead>{t('detail.tables.year')}</TableHead>
                        <TableHead>{t('detail.tables.vin')}</TableHead>
                        <TableHead>{t('detail.tables.plate')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(customer.vehicles ?? []).map((vehicle) => (
                        <TableRow
                          key={vehicle.id}
                          className='cursor-pointer hover:bg-accent/50'
                          onClick={() => navigate(`/vehicles/${vehicle.id}`)}
                          tabIndex={0}
                          role='button'
                          aria-label={t('detail.aria.openVehicle', {
                            make: vehicle.make,
                            model: vehicle.model,
                          })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(`/vehicles/${vehicle.id}`)
                            }
                          }}
                        >
                          <TableCell className='font-medium'>{vehicle.make} {vehicle.model}</TableCell>
                          <TableCell>{vehicle.year}</TableCell>
                          <TableCell>{vehicle.vin || notAvailable}</TableCell>
                          <TableCell>{vehicle.plate || notAvailable}</TableCell>
                        </TableRow>
                      ))}
                      {(customer.vehicles ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>{t('detail.tables.noVehiclesRegistered')}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='consent' className='mt-4'>
              <CustomerConsentPanel customerId={customer.id} contactEmail={customer.email} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={vehiclePickerOpen} onOpenChange={setVehiclePickerOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('detail.selectVehicleTitle')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-2 max-h-80 overflow-auto'>
            {customerVehicles.map((vehicle) => (
              <button
                key={vehicle.id}
                type='button'
                className='w-full rounded-lg border px-3 py-2 text-left hover:bg-accent'
                aria-label={t('detail.aria.selectVehicle', {
                  description: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                  vin: vehicle.vin || notAvailable,
                  plate: vehicle.plate || notAvailable,
                })}
                onClick={() => {
                  setVehiclePickerOpen(false)
                  setSelectedWorkshopVehicle(vehicle)
                }}
              >
                <div className='font-medium'>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </div>
                <div className='text-xs text-muted-foreground'>
                  {t('detail.vehicleSummary', {
                    vin: vehicle.vin || notAvailable,
                    plate: vehicle.plate || notAvailable,
                  })}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {selectedWorkshopVehicle && (
        <StartServiceDialog
          onOpenChange={(open) => {
            if (!open) {
              setSelectedWorkshopVehicle(null)
            }
          }}
          customerId={customer.id}
          vehicleId={selectedWorkshopVehicle.id}
          vehicleDescription={getVehicleDescription(selectedWorkshopVehicle)}
          onCreated={(order) => navigate(`/workshop/orders/${order.id}`)}
        />
      )}
    </div>
  )
}
