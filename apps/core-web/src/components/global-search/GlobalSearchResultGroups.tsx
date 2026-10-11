import { Building2, Car, Package, UserRound, Wrench } from 'lucide-react'

import type { InventoryItem, WorkshopOrder } from '@/api/types'
import type { WorkshopSearchCustomer, WorkshopSearchVehicle } from '@/hooks/useGlobalSearch'
import { CommandGroup, CommandItem, CommandSeparator } from '@/components/ui/command'
import { StatusBadge } from '@/components/status/StatusBadge'
import {
  currencyFormatter,
  getCustomerContactDetails,
  getCustomerDisplayName,
  getCustomerSearchValue,
  getOrderSearchValue,
  getOrderSubtitle,
  getVehicleMakeModel,
  getVehicleSubtitle,
} from './global-search-format'
import type { QuickActionSection } from './global-search-quick-actions'

type SelectHandler = (href: string) => void

interface QuickActionGroupProps {
  section: QuickActionSection
  showSeparator: boolean
  onSelect: SelectHandler
}

export function QuickActionGroup({ section, showSeparator, onSelect }: QuickActionGroupProps) {
  return (
    <>
      <CommandGroup heading={section.heading}>
        {section.items.map((action) => {
          const Icon = action.icon

          return (
            <CommandItem
              key={action.href}
              value={`${action.label} ${action.description}`}
              onSelect={() => onSelect(action.href)}
            >
              <Icon aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{action.label}</span>
                <span className="truncate text-xs text-muted-foreground">{action.description}</span>
              </div>
            </CommandItem>
          )
        })}
      </CommandGroup>

      {showSeparator ? <CommandSeparator /> : null}
    </>
  )
}

export function CustomerResultsGroup({
  customers,
  onSelect,
}: {
  customers: WorkshopSearchCustomer[]
  onSelect: SelectHandler
}) {
  if (customers.length === 0) return null

  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Customers">
        {customers.map((customer) => {
          const CustomerIcon = customer.type === 'COMPANY' ? Building2 : UserRound
          const contactDetails = getCustomerContactDetails(customer)

          return (
            <CommandItem
              key={customer.id}
              value={getCustomerSearchValue(customer)}
              onSelect={() => onSelect(`/customers/${customer.id}`)}
            >
              <CustomerIcon aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{getCustomerDisplayName(customer)}</span>
                {contactDetails ? (
                  <span className="truncate text-xs text-muted-foreground">{contactDetails}</span>
                ) : null}
              </div>
            </CommandItem>
          )
        })}
      </CommandGroup>
    </>
  )
}

export function VehicleResultsGroup({
  vehicles,
  onSelect,
}: {
  vehicles: WorkshopSearchVehicle[]
  onSelect: SelectHandler
}) {
  if (vehicles.length === 0) return null

  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Vehicles">
        {vehicles.map((vehicle) => {
          const makeModel = getVehicleMakeModel(vehicle)
          const displayTitle = vehicle.plate || makeModel
          const subtitle = getVehicleSubtitle(vehicle, makeModel)

          return (
            <CommandItem
              key={vehicle.id}
              value={`${vehicle.plate ?? ''} ${vehicle.make} ${vehicle.model} ${vehicle.vin ?? ''} ${vehicle.year}`}
              onSelect={() => onSelect(`/vehicles/${vehicle.id}`)}
            >
              <Car aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{displayTitle}</span>
                {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
              </div>
            </CommandItem>
          )
        })}
      </CommandGroup>
    </>
  )
}

export function OrderResultsGroup({
  orders,
  onSelect,
}: {
  orders: WorkshopOrder[]
  onSelect: SelectHandler
}) {
  if (orders.length === 0) return null

  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Workshop orders">
        {orders.map((order) => {
          const subtitle = getOrderSubtitle(order)

          return (
            <CommandItem
              key={order.id}
              value={getOrderSearchValue(order)}
              onSelect={() => onSelect(`/workshop/orders/${order.id}`)}
            >
              <Wrench aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{order.order_number ?? order.id}</span>
                {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
              </div>
              {order.status ? (
                <div className="ml-4 shrink-0">
                  <StatusBadge status={order.status} />
                </div>
              ) : null}
            </CommandItem>
          )
        })}
      </CommandGroup>
    </>
  )
}

export function InventoryResultsGroup({
  items,
  onSelect,
}: {
  items: InventoryItem[]
  onSelect: SelectHandler
}) {
  if (items.length === 0) return null

  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Inventory">
        {items.map((item) => (
          <CommandItem
            key={item.id}
            value={`${item.sku} ${item.name} ${item.brand}`}
            onSelect={() => onSelect(`/inventory/${item.id}/ledger?sku=${encodeURIComponent(item.sku)}`)}
          >
            <Package aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{item.sku}</span>
              <span className="truncate text-xs text-muted-foreground">{item.name}</span>
            </div>
            <div className="ml-4 flex shrink-0 flex-col items-end text-xs text-slate-500">
              <span className="tabular-nums">{item.quantity_available} in stock</span>
              <span className="tabular-nums">{currencyFormatter.format(item.price)}</span>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  )
}
