import { Phone, Clock, Key, MapPin, User, Printer } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { WorkshopOrder } from '@/api/types'

type WorkshopMechanicOption = {
  id: string
  name: string
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, '')
}

function getCustomerName(order: WorkshopOrder) {
  if (!order.customer) return 'Dealer stock'
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
  assignedTechName?: string | null
  bayName?: string | null
  onPrint: () => void
}

export function OrderTopBar({
  order,
  assignedTechName,
  bayName,
  onPrint,
}: OrderTopBarProps) {
  const customerName = getCustomerName(order)
  const vehicleLabel = getVehicleLabel(order)
  const plate = order.vehicle.plate || 'N/A'

  return (
    <header>
      <Card className='mb-8'>
        <CardContent className='p-4 sm:p-5'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
            <div className='space-y-3'>
              <div className='flex items-center gap-3'>
                <h1 className='text-2xl font-semibold tracking-tight'>{order.order_number ?? `#${order.id}`}</h1>
                <StatusBadge status={order.status} />
              </div>
              <p className='text-sm text-slate-500'>
                {customerName} · {vehicleLabel} · {plate}
              </p>
              <p className='text-sm text-slate-500'>
                Promised time: Not set · Tech: {assignedTechName ?? 'Unassigned'} · Bay: {bayName ?? 'Unassigned'}
              </p>
            </div>

            <Button variant='outline' onClick={onPrint}>
              <Printer className='h-4 w-4 mr-2' />
              Print Job Card
            </Button>
          </div>
        </CardContent>
      </Card>
    </header>
  )
}

export function CustomerVehicleInfo({
  order,
  assignedTechName,
  assignedTechId,
  mechanics = [],
  bayName,
  isLocked = false,
  isAssigningTech = false,
  onAssignedTechChange,
}: {
  order: WorkshopOrder
  assignedTechName?: string | null
  assignedTechId?: string | null
  mechanics?: WorkshopMechanicOption[]
  bayName?: string | null
  isLocked?: boolean
  isAssigningTech?: boolean
  onAssignedTechChange?: (mechanicId: string | null) => void
}) {
  const customerName = getCustomerName(order)
  const customerPhone = order.customer?.phone ?? ''

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
              {onAssignedTechChange ? (
                <Select
                  value={assignedTechId ?? 'unassigned'}
                  onValueChange={(value) =>
                    onAssignedTechChange(value === 'unassigned' ? null : value)
                  }
                  disabled={isLocked || isAssigningTech}
                >
                  <SelectTrigger
                    className='h-9 font-medium'
                    data-testid='assigned-tech-select'
                    aria-label='Assigned Tech'
                  >
                    <div className='flex items-center'>
                      <User className='w-4 h-4 mr-1.5 text-slate-500' />
                      <SelectValue placeholder='Unassigned' />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='unassigned'>Unassigned</SelectItem>
                    {mechanics.map((mechanic) => (
                      <SelectItem key={mechanic.id} value={mechanic.id}>
                        {mechanic.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className='font-medium flex items-center'>
                  <User className='w-4 h-4 mr-1.5 text-slate-500' />
                  {assignedTechName ?? 'Unassigned'}
                </div>
              )}
            </div>
            <div>
              <div className='text-muted-foreground mb-1'>Bay / Location</div>
              <div className='font-medium flex items-center'>
                <MapPin className='w-4 h-4 mr-1.5 text-slate-500' />
                {bayName ?? 'Unassigned'}
              </div>
            </div>
            <div>
              <div className='text-muted-foreground mb-1'>Promised Time</div>
              <div className='font-medium flex items-center'>
                <Clock className='w-4 h-4 mr-1.5 text-slate-500' />
                Not set
              </div>
            </div>
            <div>
              <div className='text-muted-foreground mb-1'>Key Tag</div>
              <div className='font-medium flex items-center'>
                <Key className='w-4 h-4 mr-1.5 text-slate-500' />
                Not set
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
            <div className='text-muted-foreground'>{order.customer?.email}</div>
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
