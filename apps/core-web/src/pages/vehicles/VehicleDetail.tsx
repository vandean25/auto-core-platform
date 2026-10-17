import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Wrench } from 'lucide-react'
import { TyreSetsSummary } from '@/features/tyre-storage/TyreSetsSummary'
import { toast } from 'sonner'
import { useVehicle, useUpdateVehicle } from '@/api/vehicles'
import type { VehicleSale } from '@/api/vehicle-stock'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { StartServiceDialog } from '@/components/workshop/StartServiceDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-utils'
import { formatDate } from '@/lib/format'
import type {
  Customer,
  InvoiceStatus,
  SalesOrderStatus,
  Vehicle,
  WorkshopOrderStatus,
} from '@/api/types'
import { VehicleDialog } from '@/components/vehicles/VehicleDialog'
import { VehicleRegulatorySection } from '@/components/vehicles/VehicleRegulatorySection'
import { NovaPreviewPanel } from '@/components/vehicles/NovaPreviewPanel'
import { VehiclePickerlSection } from '@/components/vehicles/VehiclePickerlSection'
import { VehicleGewaehrleistungSection } from '@/components/vehicles/VehicleGewaehrleistungSection'
import type { components } from '@/api/generated/openapi'
import type {
  VehicleNovaClass,
  VehicleRegulatoryValues,
} from '@/components/vehicles/VehicleRegulatorySection'

type VehicleSalesOrderSummary = {
  id: string
  order_number: string
  status: SalesOrderStatus
  total_amount: string | number
  createdAt: string
}

type VehicleWorkshopLine = {
  quantity?: string | number
  unit_price?: string | number
  qty?: string | number
  unitPrice?: string | number
}

type VehicleWorkshopTask = {
  line_items?: VehicleWorkshopLine[]
  lineItems?: VehicleWorkshopLine[]
}

type VehicleWorkshopOrderSummary = {
  id: string
  order_number?: string
  status: WorkshopOrderStatus
  createdAt: string
  tasks?: VehicleWorkshopTask[]
}

type VehicleInvoiceSummary = {
  id: string
  invoice_number: string | null
  status: InvoiceStatus
  date: string
  total_gross: string | number
}

type VehicleDetailResponse = Vehicle & {
  customer?: Customer | null
  sales_orders?: VehicleSalesOrderSummary[]
  workshop_orders?: VehicleWorkshopOrderSummary[]
  invoices?: VehicleInvoiceSummary[]
  pickerl_due?: components['schemas']['PickerlDueDto']
  sales?: VehicleSale[]
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

function getCustomerName(customer: Customer) {
  if (customer.type === 'COMPANY' && customer.company_name) {
    return customer.company_name
  }
  return `${customer.first_name} ${customer.last_name}`.trim()
}

function getWorkshopOrderTotal(order: VehicleWorkshopOrderSummary) {
  return (order.tasks ?? []).reduce((taskSum, task) => {
    const lines = task.line_items ?? task.lineItems ?? []
    const total = lines.reduce(
      (sum, line) => sum + toNumber(line.quantity ?? line.qty) * toNumber(line.unit_price ?? line.unitPrice),
      0,
    )
    return taskSum + total
  }, 0)
}

export default function VehicleDetail() {
  const { t } = useTranslation('vehicles')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicles')
  }, [])
  const navigate = useNavigate()
  const { id = '' } = useParams<{ id: string }>()
  const { data: vehicle, isLoading, isError, error } = useVehicle<VehicleDetailResponse>(id)
  const updateVehicle = useUpdateVehicle()
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [startServiceOpen, setStartServiceOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  if (isLoading) {
    return <div className='p-8 text-center'>{t('detail.loading')}</div>
  }

  if (isError) {
    return (
      <div className='p-8 text-center'>
        {t('detail.loadFailed', {
          message: (error as Error)?.message || t('shared.unknownError'),
        })}
      </div>
    )
  }

  if (!vehicle) {
    return <div className='p-8 text-center'>{t('detail.notFound')}</div>
  }

  const orderTypeLabel = (type: ActiveOrderRow['type']) =>
    t(type === 'Sales' ? 'detail.orderTypes.sales' : 'detail.orderTypes.service')

  const activeSalesOrders: ActiveOrderRow[] = (vehicle.sales_orders ?? [])
    .filter((order) => order.status !== 'INVOICED')
    .map((order) => ({
      id: order.id,
      type: 'Sales',
      number: order.order_number || `#${order.id.slice(0, 8)}`,
      createdAt: order.createdAt,
      status: order.status,
      total: toNumber(order.total_amount),
    }))

  const activeWorkshopOrders: ActiveOrderRow[] = (vehicle.workshop_orders ?? [])
    .filter((order) => order.status !== 'INVOICED')
    .map((order) => ({
      id: order.id,
      type: 'Service',
      number: order.order_number ?? `#${order.id.slice(0, 8)}`,
      createdAt: order.createdAt,
      status: order.status,
      total: getWorkshopOrderTotal(order),
    }))

  const activeOrders = [...activeSalesOrders, ...activeWorkshopOrders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  type EditableVehicleField =
    | 'make'
    | 'model'
    | 'year'
    | 'engine_code'
    | 'vin'
    | 'plate'

  const saveRegulatoryField = async (patch: Partial<VehicleRegulatoryValues>) => {
    try {
      await updateVehicle.mutateAsync({
        id: vehicle.id,
        data: patch,
      })
      toast.success(t('detail.updated'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('detail.updateFailed')))
      throw error
    }
  }

  const handleSaveVehicleField = async (
    field: EditableVehicleField,
    nextValue: string,
  ) => {
    const payload: Record<string, string | number> = {}

    if (field === 'year') {
      const parsedYear = Number(nextValue)
      if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
        toast.error(t('detail.invalidYear'))
        throw new Error('Invalid year')
      }
      payload.year = parsedYear
    } else {
      payload[field] = nextValue
    }

    try {
      await updateVehicle.mutateAsync({
        id: vehicle.id,
        data: payload,
      })
      toast.success(t('detail.updated'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('detail.updateFailed')))
      throw error
    }
  }

  const openCustomerDialog = () => {
    setSelectedCustomer(vehicle.customer ?? null)
    setCustomerDialogOpen(true)
  }

  const handleSaveCustomer = async () => {
    if ((selectedCustomer?.id ?? null) === (vehicle.customer?.id ?? null)) {
      setCustomerDialogOpen(false)
      return
    }

    try {
      await updateVehicle.mutateAsync({
        id: vehicle.id,
        data: { customer_id: selectedCustomer?.id ?? null },
      })
      toast.success(t('detail.customerUpdated'))
      setCustomerDialogOpen(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('detail.customerUpdateFailed')))
    }
  }

  const getVehicleDescription = () => {
    const base = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    return vehicle.plate ? `${base} (${vehicle.plate})` : base
  }

  const handleCreateServiceOrder = () => {
    if (!vehicle.customer?.id) {
      toast.error(t('detail.serviceOrderNeedsCustomer'))
      return
    }
    setStartServiceOpen(true)
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div className='flex items-center gap-4'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => navigate(-1)}
            aria-label={t('detail.aria.goBack')}
          >
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            <div className='flex items-center gap-2 text-slate-500 text-sm'>
              <span>{t('detail.idLabel', { id: vehicle.id.substring(0, 8) })}</span>
              {vehicle.plate && <Badge variant='outline'>{vehicle.plate}</Badge>}
            </div>
          </div>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => setEditDialogOpen(true)}>
            {t('detail.editVehicle')}
          </Button>
          <Button variant='outline' onClick={handleCreateServiceOrder}>
            <Wrench className='mr-2 h-4 w-4' /> {t('detail.serviceOrder')}
          </Button>
        </div>
      </div>

      <VehicleDialog
        vehicle={vehicle}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <Card className='lg:col-span-1'>
          <CardHeader>
            <CardTitle className='text-base font-semibold'>{t('detail.vehicleInfo')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            {vehicle.customer?.id ? (
              <TyreSetsSummary vehicleId={vehicle.id} customerId={vehicle.customer.id} />
            ) : null}
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <div className='text-muted-foreground'>{t('detail.year')}</div>
                <InlineEdit
                  value={String(vehicle.year)}
                  onSave={(nextValue) => handleSaveVehicleField('year', nextValue)}
                  placeholder={t('detail.placeholders.year')}
                  ariaLabel={t('detail.aria.year')}
                />
              </div>
              <div>
                <div className='text-muted-foreground'>{t('detail.engine')}</div>
                <InlineEdit
                  value={vehicle.engine_code}
                  onSave={(nextValue) => handleSaveVehicleField('engine_code', nextValue)}
                  placeholder={t('detail.placeholders.engineCode')}
                  emptyText={t('detail.empty.engineCode')}
                  ariaLabel={t('detail.aria.engineCode')}
                />
              </div>
              <div>
                <div className='text-muted-foreground'>{t('detail.make')}</div>
                <InlineEdit
                  value={vehicle.make}
                  onSave={(nextValue) => handleSaveVehicleField('make', nextValue)}
                  placeholder={t('detail.placeholders.make')}
                  ariaLabel={t('detail.aria.make')}
                />
              </div>
              <div>
                <div className='text-muted-foreground'>{t('detail.model')}</div>
                <InlineEdit
                  value={vehicle.model}
                  onSave={(nextValue) => handleSaveVehicleField('model', nextValue)}
                  placeholder={t('detail.placeholders.model')}
                  ariaLabel={t('detail.aria.model')}
                />
              </div>
              <div className='col-span-2'>
                <div className='text-muted-foreground'>{t('detail.vin')}</div>
                <InlineEdit
                  value={vehicle.vin}
                  onSave={(nextValue) => handleSaveVehicleField('vin', nextValue)}
                  placeholder={t('detail.placeholders.vin')}
                  emptyText={t('detail.empty.vin')}
                  ariaLabel={t('detail.aria.vin')}
                />
              </div>
              <div className='col-span-2'>
                <div className='text-muted-foreground'>{t('detail.plate')}</div>
                <InlineEdit
                  value={vehicle.plate}
                  onSave={(nextValue) => handleSaveVehicleField('plate', nextValue)}
                  placeholder={t('detail.placeholders.plate')}
                  emptyText={t('detail.empty.plate')}
                  ariaLabel={t('detail.aria.plate')}
                />
              </div>
            </div>

            <VehiclePickerlSection
              vehicleId={vehicle.id}
              pickerlDue={vehicle.pickerl_due}
            />

            <VehicleGewaehrleistungSection sales={vehicle.sales ?? []} />

            <VehicleRegulatorySection
              mode='inline'
              values={{
                first_registration_date:
                  typeof vehicle.first_registration_date === 'string'
                    ? vehicle.first_registration_date.slice(0, 10)
                    : vehicle.first_registration_date ?? null,
                co2_wltp_g_km: vehicle.co2_wltp_g_km ?? null,
                co2_nedc_g_km: vehicle.co2_nedc_g_km ?? null,
                typenschein_no: vehicle.typenschein_no ?? null,
                nova_class: (vehicle.nova_class as VehicleNovaClass | null) ?? null,
                emission_class: vehicle.emission_class ?? null,
              }}
              onChange={(patch) => void saveRegulatoryField(patch)}
              renderInlineField={(field, label, value, onSave) => (
                <div key={field}>
                  <div className='text-muted-foreground'>{label}</div>
                  <InlineEdit
                    value={value}
                    onSave={onSave}
                    ariaLabel={label}
                  />
                </div>
              )}
            />

            <NovaPreviewPanel
              vehicleId={vehicle.id}
              firstRegistrationDate={
                typeof vehicle.first_registration_date === 'string'
                  ? vehicle.first_registration_date.slice(0, 10)
                  : vehicle.first_registration_date ?? null
              }
              co2Wltp={vehicle.co2_wltp_g_km ?? null}
              co2Nedc={vehicle.co2_nedc_g_km ?? null}
              typenscheinNo={vehicle.typenschein_no ?? null}
              novaClass={vehicle.nova_class ?? null}
            />

            <div className='pt-3 border-t'>
              <div className='flex items-center justify-between gap-2 mb-1'>
                <div className='text-muted-foreground'>{t('detail.customer')}</div>
                <Button
                  variant='outline'
                  size='sm'
                  className='h-7 px-2'
                  onClick={openCustomerDialog}
                >
                  {t('detail.changeCustomer')}
                </Button>
              </div>
              {vehicle.customer ? (
                <Link className='font-medium hover:underline' to={`/customers/${vehicle.customer.id}`}>
                  {getCustomerName(vehicle.customer)}
                </Link>
              ) : (
                <span className='font-medium'>{t('shared.unassigned')}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className='lg:col-span-2'>
          <Tabs defaultValue='orders'>
            <TabsList>
              <TabsTrigger value='orders'>{t('detail.tabs.activeOrders')}</TabsTrigger>
              <TabsTrigger value='invoices'>{t('detail.tabs.invoiceHistory')}</TabsTrigger>
              <TabsTrigger value='service'>{t('detail.tabs.serviceOrders')}</TabsTrigger>
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
                      {(vehicle.invoices ?? []).map((invoice) => (
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
                          <TableCell className='font-medium'>{invoice.invoice_number || t('shared.draft')}</TableCell>
                          <TableCell>{formatDate(invoice.date)}</TableCell>
                          <TableCell><StatusBadge status={invoice.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(toNumber(invoice.total_gross))}</TableCell>
                        </TableRow>
                      ))}
                      {(vehicle.invoices ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>{t('detail.tables.noInvoices')}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='service' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('detail.tables.serviceOrderNumber')}</TableHead>
                        <TableHead>{t('detail.tables.date')}</TableHead>
                        <TableHead>{t('detail.tables.status')}</TableHead>
                        <TableHead className='text-right'>{t('detail.tables.total')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(vehicle.workshop_orders ?? []).map((order) => (
                        <TableRow
                          key={order.id}
                          className='cursor-pointer hover:bg-accent/50'
                          onClick={() => navigate(`/workshop/orders/${order.id}`)}
                          tabIndex={0}
                          role='button'
                          aria-label={t('detail.aria.openServiceOrder', {
                            number: order.order_number ?? order.id,
                          })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(`/workshop/orders/${order.id}`)
                            }
                          }}
                        >
                          <TableCell className='font-medium'>{order.order_number ?? `#${order.id}`}</TableCell>
                          <TableCell>{formatDate(order.createdAt)}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(getWorkshopOrderTotal(order))}</TableCell>
                        </TableRow>
                      ))}
                      {(vehicle.workshop_orders ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>{t('detail.tables.noServiceOrders')}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('detail.changeCustomerDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <CustomerSearch
              value={selectedCustomer}
              onChange={(customerValue) => setSelectedCustomer(customerValue)}
            />
            <div className='flex justify-end gap-2'>
              <Button
                variant='outline'
                onClick={() => setSelectedCustomer(null)}
                disabled={!selectedCustomer}
              >
                {t('detail.changeCustomerDialog.unassign')}
              </Button>
              <Button
                variant='outline'
                onClick={() => setCustomerDialogOpen(false)}
              >
                {t('detail.changeCustomerDialog.cancel')}
              </Button>
              <Button onClick={() => void handleSaveCustomer()}>{t('detail.changeCustomerDialog.save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {vehicle.customer && (
        <StartServiceDialog
          open={startServiceOpen}
          onOpenChange={setStartServiceOpen}
          customerId={vehicle.customer.id}
          vehicleId={vehicle.id}
          vehicleDescription={getVehicleDescription()}
          onCreated={(order) => navigate(`/workshop/orders/${order.id}`)}
        />
      )}
    </div>
  )
}
