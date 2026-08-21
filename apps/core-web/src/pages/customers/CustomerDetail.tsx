import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCustomer, useUpdateCustomer } from '@/api/customers'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { StartServiceDialog } from '@/components/workshop/StartServiceDialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Phone, Mail, MapPin, ArrowLeft, Package, Wrench } from 'lucide-react'
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

export default function CustomerDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data: customer, isLoading, error } = useCustomer<CustomerDetailResponse>(id ?? '')
  const updateCustomer = useUpdateCustomer()
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false)
  const [selectedWorkshopVehicle, setSelectedWorkshopVehicle] = useState<Vehicle | null>(null)

  if (isLoading) {
    return <div className='p-8 text-center'>Loading customer details...</div>
  }

  if (error) {
    return <div className='p-8 text-center'>Failed to load customer: {(error as Error).message}</div>
  }

  if (!customer) {
    return <div className='p-8 text-center'>Customer not found.</div>
  }

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
      toast.success('Customer updated')
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast.error(error.message)
      } else {
        toast.error('Failed to update customer')
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
      toast.error('No vehicle found. Add a vehicle first to create a workshop order.')
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
            <Link to='/customers' aria-label='Back to customers'>
              <ArrowLeft className='h-4 w-4' />
            </Link>
          </Button>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {customer.type === 'COMPANY'
                ? customer.company_name
                : `${customer.first_name} ${customer.last_name}`}
            </h1>
            <div className='flex items-center gap-2 text-slate-500 text-sm'>
              {customer.type === 'COMPANY' && <Badge variant='outline'>Company</Badge>}
              <span>ID: {customer.id.substring(0, 8)}</span>
            </div>
          </div>
        </div>
        <div className='flex gap-2'>
          <Button asChild>
            <Link to={`/sales-orders/new?customerId=${customer.id}`}>
              <Package className='mr-2 h-4 w-4' /> Sales Order
            </Link>
          </Button>
          <Button variant='outline' onClick={handleCreateWorkshopOrder}>
            <Wrench className='mr-2 h-4 w-4' /> Workshop Order
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <Card className='lg:col-span-1'>
          <CardHeader>
            <CardTitle className='text-base font-semibold'>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {customer.type === 'COMPANY' ? (
              <div className='space-y-2'>
                <div>
                  <div className='text-xs text-muted-foreground mb-1'>Company Name</div>
                  <InlineEdit
                    value={customer.company_name}
                    onSave={(nextValue) => handleSaveCustomerField('company_name', nextValue)}
                    placeholder='Company name'
                    emptyText='Add company name'
                    ariaLabel='Company name'
                  />
                </div>
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                  <div>
                    <div className='text-xs text-muted-foreground mb-1'>Contact First Name</div>
                    <InlineEdit
                      value={customer.first_name}
                      onSave={(nextValue) => handleSaveCustomerField('first_name', nextValue)}
                      placeholder='First name'
                      emptyText='Add first name'
                      ariaLabel='Business contact first name'
                    />
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground mb-1'>Contact Last Name</div>
                    <InlineEdit
                      value={customer.last_name}
                      onSave={(nextValue) => handleSaveCustomerField('last_name', nextValue)}
                      placeholder='Last name'
                      emptyText='Add last name'
                      ariaLabel='Business contact last name'
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                <div>
                  <div className='text-xs text-muted-foreground mb-1'>First Name</div>
                  <InlineEdit
                    value={customer.first_name}
                    onSave={(nextValue) => handleSaveCustomerField('first_name', nextValue)}
                    placeholder='First name'
                    emptyText='Add first name'
                    ariaLabel='Customer first name'
                  />
                </div>
                <div>
                  <div className='text-xs text-muted-foreground mb-1'>Last Name</div>
                  <InlineEdit
                    value={customer.last_name}
                    onSave={(nextValue) => handleSaveCustomerField('last_name', nextValue)}
                    placeholder='Last name'
                    emptyText='Add last name'
                    ariaLabel='Customer last name'
                  />
                </div>
              </div>
            )}

            <div className='flex items-center gap-2'>
              <Mail className='h-4 w-4 text-muted-foreground' />
              <InlineEdit
                value={customer.email}
                onSave={(nextValue) => handleSaveCustomerField('email', nextValue)}
                placeholder='name@example.com'
                emptyText='Add email'
                ariaLabel='Customer email'
              />
            </div>
            <div className='flex items-center gap-2'>
              <Phone className='h-4 w-4 text-muted-foreground' />
              <InlineEdit
                value={customer.phone}
                onSave={(nextValue) => handleSaveCustomerField('phone', nextValue)}
                placeholder='+43 ...'
                emptyText='Add phone'
                ariaLabel='Customer phone'
              />
            </div>
            <div className='flex items-start gap-2'>
              <MapPin className='h-4 w-4 text-muted-foreground mt-1' />
              <div className='w-full space-y-1'>
                <InlineEdit
                  mode='textarea'
                  rows={3}
                  value={customer.address_street}
                  onSave={(nextValue) => handleSaveCustomerField('address_street', nextValue)}
                  placeholder='Street and house number'
                  emptyText='Add street address'
                  ariaLabel='Customer street address'
                />
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
                  <InlineEdit
                    value={customer.address_zip}
                    onSave={(nextValue) => handleSaveCustomerField('address_zip', nextValue)}
                    placeholder='ZIP code'
                    emptyText='Add ZIP'
                    ariaLabel='Customer ZIP code'
                  />
                  <InlineEdit
                    value={customer.address_city}
                    onSave={(nextValue) => handleSaveCustomerField('address_city', nextValue)}
                    placeholder='City'
                    emptyText='Add city'
                    ariaLabel='Customer city'
                  />
                </div>
                <InlineEdit
                  value={customer.address_country}
                  onSave={(nextValue) => handleSaveCustomerField('address_country', nextValue)}
                  placeholder='Country'
                  emptyText='Add country'
                  ariaLabel='Customer country'
                />
              </div>
            </div>
            <div className='pt-2 border-t'>
              <span className='text-sm font-medium'>VAT ID:</span>
              <div className='mt-1'>
                <InlineEdit
                  value={customer.vat_id}
                  onSave={(nextValue) => handleSaveCustomerField('vat_id', nextValue)}
                  placeholder='VAT ID'
                  emptyText='Add VAT ID'
                  ariaLabel='Customer VAT ID'
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className='lg:col-span-2'>
          <Tabs defaultValue='orders'>
            <TabsList>
              <TabsTrigger value='orders'>Active Orders</TabsTrigger>
              <TabsTrigger value='invoices'>Invoice History</TabsTrigger>
              <TabsTrigger value='vehicles'>Vehicles</TabsTrigger>
            </TabsList>

            <TabsContent value='orders' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className='text-right'>Total</TableHead>
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
                          aria-label={`Open ${order.type} order ${order.number}`}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(order.type === 'Service' ? `/workshop/orders/${order.id}` : `/sales-orders/${order.id}`)
                            }
                          }}
                        >
                          <TableCell className='font-medium'>{order.number}</TableCell>
                          <TableCell>{order.type}</TableCell>
                          <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(order.total)}</TableCell>
                        </TableRow>
                      ))}
                      {activeOrders.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className='text-center py-4 text-muted-foreground'>No active orders</TableCell>
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
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className='text-right'>Total</TableHead>
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
                          aria-label={`Open invoice ${invoice.invoice_number || invoice.id}`}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(`/sales/invoices/${invoice.id}`)
                            }
                          }}
                        >
                          <TableCell className='font-medium'>{invoice.invoice_number || 'Draft'}</TableCell>
                          <TableCell>{new Date(invoice.date).toLocaleDateString()}</TableCell>
                          <TableCell><StatusBadge status={invoice.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(toNumber(invoice.total_gross))}</TableCell>
                        </TableRow>
                      ))}
                      {(customer.invoices ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>No recent invoices</TableCell>
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
                        <TableHead>Make/Model</TableHead>
                        <TableHead>Year</TableHead>
                        <TableHead>VIN</TableHead>
                        <TableHead>Plate</TableHead>
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
                          aria-label={`Open vehicle ${vehicle.make} ${vehicle.model}`}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(`/vehicles/${vehicle.id}`)
                            }
                          }}
                        >
                          <TableCell className='font-medium'>{vehicle.make} {vehicle.model}</TableCell>
                          <TableCell>{vehicle.year}</TableCell>
                          <TableCell>{vehicle.vin || 'N/A'}</TableCell>
                          <TableCell>{vehicle.plate || 'N/A'}</TableCell>
                        </TableRow>
                      ))}
                      {(customer.vehicles ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>No vehicles registered</TableCell>
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

      <Dialog open={vehiclePickerOpen} onOpenChange={setVehiclePickerOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>Select Vehicle</DialogTitle>
          </DialogHeader>
          <div className='space-y-2 max-h-80 overflow-auto'>
            {customerVehicles.map((vehicle) => (
              <button
                key={vehicle.id}
                type='button'
                className='w-full rounded-lg border px-3 py-2 text-left hover:bg-accent'
                aria-label={`Select vehicle ${vehicle.year} ${vehicle.make} ${vehicle.model}, VIN ${vehicle.vin || 'not available'}, plate ${vehicle.plate || 'not available'}`}
                onClick={() => {
                  setVehiclePickerOpen(false)
                  setSelectedWorkshopVehicle(vehicle)
                }}
              >
                <div className='font-medium'>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </div>
                <div className='text-xs text-muted-foreground'>
                  VIN: {vehicle.vin || 'N/A'} | Plate: {vehicle.plate || 'N/A'}
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
