import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { useVehicle, useUpdateVehicle } from '@/api/vehicles'
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
import type {
  Customer,
  InvoiceStatus,
  SalesOrderStatus,
  Vehicle,
  WorkshopOrderStatus,
} from '@/api/types'

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
  const navigate = useNavigate()
  const { id = '' } = useParams<{ id: string }>()
  const { data: vehicle, isLoading } = useVehicle<VehicleDetailResponse>(id)
  const updateVehicle = useUpdateVehicle()
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [startServiceOpen, setStartServiceOpen] = useState(false)

  if (isLoading) {
    return <div className='p-8 text-center'>Loading vehicle details...</div>
  }

  if (!vehicle) {
    return <div className='p-8 text-center'>Vehicle not found.</div>
  }

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
      number: `#${order.id}`,
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

  const handleSaveVehicleField = async (
    field: EditableVehicleField,
    nextValue: string,
  ) => {
    const payload: Record<string, string | number> = {}

    if (field === 'year') {
      const parsedYear = Number(nextValue)
      if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
        toast.error('Year must be a valid number between 1900 and 2100')
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
      toast.success('Vehicle updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update vehicle')
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
      toast.success('Vehicle customer updated')
      setCustomerDialogOpen(false)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update vehicle customer')
    }
  }

  const getVehicleDescription = () => {
    const base = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    return vehicle.plate ? `${base} (${vehicle.plate})` : base
  }

  const handleCreateServiceOrder = () => {
    if (!vehicle.customer?.id) {
      toast.error('Assign a customer to this vehicle before creating a service order.')
      return
    }
    setStartServiceOpen(true)
  }

  return (
    <div className='w-full max-w-7xl mx-auto p-6 space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div className='flex items-center gap-4'>
          <Button variant='ghost' size='icon' onClick={() => navigate(-1)}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            <div className='flex items-center gap-2 text-slate-500 text-sm'>
              <span>ID: {vehicle.id.substring(0, 8)}</span>
              {vehicle.plate && <Badge variant='outline'>{vehicle.plate}</Badge>}
            </div>
          </div>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={handleCreateServiceOrder}>
            <Wrench className='mr-2 h-4 w-4' /> Service Order
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <Card className='lg:col-span-1'>
          <CardHeader>
            <CardTitle className='text-base font-semibold'>Vehicle Info</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <div className='text-muted-foreground'>Year</div>
                <InlineEdit
                  value={String(vehicle.year)}
                  onSave={(nextValue) => handleSaveVehicleField('year', nextValue)}
                  placeholder='Year'
                  ariaLabel='Vehicle year'
                />
              </div>
              <div>
                <div className='text-muted-foreground'>Engine</div>
                <InlineEdit
                  value={vehicle.engine_code}
                  onSave={(nextValue) => handleSaveVehicleField('engine_code', nextValue)}
                  placeholder='Engine code'
                  emptyText='Add engine code'
                  ariaLabel='Vehicle engine code'
                />
              </div>
              <div>
                <div className='text-muted-foreground'>Make</div>
                <InlineEdit
                  value={vehicle.make}
                  onSave={(nextValue) => handleSaveVehicleField('make', nextValue)}
                  placeholder='Make'
                  ariaLabel='Vehicle make'
                />
              </div>
              <div>
                <div className='text-muted-foreground'>Model</div>
                <InlineEdit
                  value={vehicle.model}
                  onSave={(nextValue) => handleSaveVehicleField('model', nextValue)}
                  placeholder='Model'
                  ariaLabel='Vehicle model'
                />
              </div>
              <div className='col-span-2'>
                <div className='text-muted-foreground'>VIN</div>
                <InlineEdit
                  value={vehicle.vin}
                  onSave={(nextValue) => handleSaveVehicleField('vin', nextValue)}
                  placeholder='VIN'
                  emptyText='Add VIN'
                  ariaLabel='Vehicle VIN'
                />
              </div>
              <div className='col-span-2'>
                <div className='text-muted-foreground'>Plate</div>
                <InlineEdit
                  value={vehicle.plate}
                  onSave={(nextValue) => handleSaveVehicleField('plate', nextValue)}
                  placeholder='Plate number'
                  emptyText='Add plate'
                  ariaLabel='Vehicle plate'
                />
              </div>
            </div>

            <div className='pt-3 border-t'>
              <div className='flex items-center justify-between gap-2 mb-1'>
                <div className='text-muted-foreground'>Customer</div>
                <Button
                  variant='outline'
                  size='sm'
                  className='h-7 px-2'
                  onClick={openCustomerDialog}
                >
                  Change Customer
                </Button>
              </div>
              {vehicle.customer ? (
                <Link className='font-medium hover:underline' to={`/customers/${vehicle.customer.id}`}>
                  {getCustomerName(vehicle.customer)}
                </Link>
              ) : (
                <span className='font-medium'>Unassigned</span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className='lg:col-span-2'>
          <Tabs defaultValue='orders'>
            <TabsList>
              <TabsTrigger value='orders'>Active Orders</TabsTrigger>
              <TabsTrigger value='invoices'>Invoice History</TabsTrigger>
              <TabsTrigger value='service'>Service Orders</TabsTrigger>
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
                      {(vehicle.invoices ?? []).map((invoice) => (
                        <TableRow
                          key={invoice.id}
                          className='cursor-pointer hover:bg-accent/50'
                          onClick={() => navigate(`/sales/invoices/${invoice.id}`)}
                        >
                          <TableCell className='font-medium'>{invoice.invoice_number || 'Draft'}</TableCell>
                          <TableCell>{new Date(invoice.date).toLocaleDateString()}</TableCell>
                          <TableCell><StatusBadge status={invoice.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(toNumber(invoice.total_gross))}</TableCell>
                        </TableRow>
                      ))}
                      {(vehicle.invoices ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>No invoices</TableCell>
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
                        <TableHead>Service Order #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className='text-right'>Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(vehicle.workshop_orders ?? []).map((order) => (
                        <TableRow
                          key={order.id}
                          className='cursor-pointer hover:bg-accent/50'
                          onClick={() => navigate(`/workshop/orders/${order.id}`)}
                        >
                          <TableCell className='font-medium'>#{order.id}</TableCell>
                          <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(getWorkshopOrderTotal(order))}</TableCell>
                        </TableRow>
                      ))}
                      {(vehicle.workshop_orders ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>No service orders</TableCell>
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
            <DialogTitle>Change Vehicle Customer</DialogTitle>
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
                Unassign
              </Button>
              <Button
                variant='outline'
                onClick={() => setCustomerDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleSaveCustomer()}>Save</Button>
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
