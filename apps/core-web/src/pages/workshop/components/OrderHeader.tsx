import { Phone, Clock, Key, MapPin, User, Package, Clock3, CircleDollarSign, Printer, FileText } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { ActionGroup } from '@/components/ui/action-group'
import { formatCurrency } from '@/lib/utils'
import type { WorkshopOrder } from '@/api/types'

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, '')
}

function getCustomerName(order: WorkshopOrder) {
  if (order.customer.type === 'COMPANY' && order.customer.company_name) {
    return order.customer.company_name
  }
  return `${order.customer.first_name} ${order.customer.last_name}`.trim()
}

function getVehicleLabel(order: WorkshopOrder) {
  return `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`
}

export interface OrderTopBarProps {
  order: WorkshopOrder
  orderPartsTotal: number
  orderLaborTotal: number
  orderGrandTotal: number
  orderLaborInternalCostTotal: number
  orderLaborMarginPercent: number | null
  hasOrderLaborCostData: boolean
  invoiceActionLabel: string
  isInvoiceActionDisabled: boolean
  onCheckoutAction: () => void
  onPrint: () => void
}

export function OrderTopBar({
  order,
  orderPartsTotal,
  orderLaborTotal,
  orderGrandTotal,
  orderLaborInternalCostTotal,
  orderLaborMarginPercent,
  hasOrderLaborCostData,
  invoiceActionLabel,
  isInvoiceActionDisabled,
  onCheckoutAction,
  onPrint,
}: OrderTopBarProps) {
  return (
    <Card className='mb-8'>
      <CardContent className='p-4 sm:p-5'>
        <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
          <div className='space-y-3'>
            <div className='flex items-center gap-3'>
              <h1 className='text-2xl font-semibold tracking-tight'>{order.order_number ?? `#${order.id}`}</h1>
              <StatusBadge status={order.status} />
              <Badge variant='secondary' className='bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300'>Waiter</Badge>
            </div>
          </div>

          <div className='flex w-full flex-col gap-3 lg:w-auto lg:items-end'>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[760px] lg:grid-cols-5'>
              <div className='rounded-xl border bg-muted/40 px-3 py-2'>
                <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                  <Package className='h-3.5 w-3.5' />
                  <span>Total Parts</span>
                </div>
                <div className='mt-1 text-sm font-medium'>{formatCurrency(orderPartsTotal)}</div>
              </div>
              <div className='rounded-xl border bg-muted/40 px-3 py-2'>
                <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                  <Clock3 className='h-3.5 w-3.5' />
                  <span>Labor Revenue</span>
                </div>
                <div className='mt-1 text-sm font-medium'>{formatCurrency(orderLaborTotal)}</div>
              </div>
              {hasOrderLaborCostData && (
                <>
                  <div className='rounded-xl border bg-muted/40 px-3 py-2'>
                    <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                      <Clock3 className='h-3.5 w-3.5' />
                      <span>Internal Labor Cost</span>
                    </div>
                    <div className='mt-1 text-sm font-medium'>
                      {formatCurrency(orderLaborInternalCostTotal)}
                    </div>
                  </div>
                  <div className='rounded-xl border bg-muted/40 px-3 py-2'>
                    <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
                      <CircleDollarSign className='h-3.5 w-3.5' />
                      <span>Est. Margin</span>
                    </div>
                    <div className='mt-1 text-sm font-medium'>
                      {orderLaborMarginPercent != null
                        ? `${orderLaborMarginPercent.toFixed(1)}%`
                        : '—'}
                    </div>
                  </div>
                </>
              )}
              <div className='rounded-xl border border-primary/20 bg-primary/10 px-3 py-2'>
                <div className='flex items-center gap-1.5 text-[11px] text-primary/80'>
                  <CircleDollarSign className='h-3.5 w-3.5' />
                  <span>Grand Total</span>
                </div>
                <div className='mt-1 text-sm font-semibold text-primary'>{formatCurrency(orderGrandTotal)}</div>
              </div>
            </div>

            <div className='flex justify-end mt-1'>
              {!isInvoiceActionDisabled ? (
                <ActionGroup
                  primaryAction={
                    <Button onClick={onCheckoutAction}>
                      <FileText className='h-4 w-4 mr-2' />
                      {invoiceActionLabel}
                    </Button>
                  }
                  secondaryActions={[
                    {
                      label: 'Print Job Card',
                      icon: <Printer className='h-4 w-4' />,
                      onClick: onPrint,
                    },
                  ]}
                />
              ) : (
                <Button variant='outline' onClick={onPrint}>
                  <Printer className='h-4 w-4 mr-2' />
                  Print Job Card
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function CustomerVehicleInfo({ order }: { order: WorkshopOrder }) {
  const customerName = getCustomerName(order)
  const customerPhone = order.customer.phone ?? ''

  return (
    <>
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base font-semibold'>Order Info</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4 text-sm'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <div>
              <div className='text-muted-foreground mb-1'>Assigned Tech</div>
              <div className='font-medium flex items-center'>
                <User className='w-4 h-4 mr-1.5 text-slate-500' />
                John Doe
              </div>
            </div>
            <div>
              <div className='text-muted-foreground mb-1'>Bay / Location</div>
              <div className='font-medium flex items-center'>
                <MapPin className='w-4 h-4 mr-1.5 text-slate-500' />
                Bay 4
              </div>
            </div>
            <div>
              <div className='text-muted-foreground mb-1'>Promised Time</div>
              <div className='font-medium flex items-center'>
                <Clock className='w-4 h-4 mr-1.5 text-slate-500' />
                04/17/2026, 17:00
              </div>
            </div>
            <div>
              <div className='text-muted-foreground mb-1'>Key Tag</div>
              <div className='font-medium flex items-center'>
                <Key className='w-4 h-4 mr-1.5 text-slate-500' />
                #42
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base font-semibold'>Customer Info</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <div>
            <div className='font-medium'>{customerName}</div>
            <div className='text-muted-foreground'>{order.customer.email}</div>
          </div>
          <div>
            <div className='text-muted-foreground'>Phone</div>
            <div className='font-medium'>{customerPhone || 'N/A'}</div>
          </div>
          {customerPhone && (
            <Button variant='outline' size='sm' className='h-8' asChild>
              <a href={`tel:${normalizePhone(customerPhone)}`}>
                <Phone className='h-3.5 w-3.5 mr-1.5' />
                Call Customer
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base font-semibold'>Vehicle Info</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <div className='font-medium'>{getVehicleLabel(order)}</div>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
            <div>
              <div className='text-muted-foreground'>VIN</div>
              <div className='font-medium'>{order.vehicle.vin || 'N/A'}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>Plate</div>
              <div className='font-medium'>{order.vehicle.plate || 'N/A'}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>Mileage</div>
              <div className='font-medium'>
                {typeof order.odometer === 'number' ? `${order.odometer.toLocaleString()} km` : '-'}
              </div>
            </div>
            <div>
              <div className='text-muted-foreground'>Fuel</div>
              <div className='font-medium'>
                {typeof order.fuel_level === 'number' ? `${order.fuel_level}%` : '-'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
