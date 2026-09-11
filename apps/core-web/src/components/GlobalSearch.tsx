import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Building2,
  Car,
  ClipboardList,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings,
  Truck,
  UserRound,
  Wrench,
} from 'lucide-react'

import { useGlobalSearch } from '@/hooks/useGlobalSearch'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { StatusBadge } from '@/components/status/StatusBadge'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'

interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type QuickAction = {
  href: string
  icon: LucideIcon
  label: string
  description: string
}

const quickActions: { heading: string; items: QuickAction[] }[] = [
  {
    heading: 'Navigate',
    items: [
      {
        href: '/dashboard',
        icon: LayoutDashboard,
        label: 'Open Dashboard',
        description: 'Review widgets and saved views.',
      },
      {
        href: '/inventory',
        icon: Package,
        label: 'Open Inventory',
        description: 'Browse parts and stock levels.',
      },
      {
        href: '/workshop/intake',
        icon: Wrench,
        label: 'Open Workshop Intake',
        description: 'Start a new workshop visit.',
      },
      {
        href: '/settings',
        icon: Settings,
        label: 'Open Settings',
        description: 'Manage finance and master data.',
      },
    ],
  },
  {
    heading: 'Create',
    items: [
      {
        href: '/sales-orders/new',
        icon: ClipboardList,
        label: 'Create Sales Order',
        description: 'Capture a new customer order.',
      },
      {
        href: '/sales/invoices/new',
        icon: ReceiptText,
        label: 'Create Sales Invoice',
        description: 'Issue a final tax invoice.',
      },
      {
        href: '/purchase-orders/new',
        icon: Truck,
        label: 'Create Purchase Order',
        description: 'Raise a new supplier order.',
      },
      {
        href: '/purchase-bills/new',
        icon: ReceiptText,
        label: 'Create Purchase Bill',
        description: 'Match a vendor invoice to receipts.',
      },
    ],
  },
]

const currencyFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})

const truncate = (text: string, max = 50) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const [search, setSearch] = React.useState('')
  const query = search.trim()
  const truncatedQuery = truncate(query)
  const { data: searchResults, isFetching, error } = useGlobalSearch(query)
  const navigate = useNavigate()

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)

    if (!nextOpen) {
      setSearch('')
    }
  }

  const handleNavigate = (href: string) => {
    setSearch('')
    onOpenChange(false)
    navigate(href)
  }

  const inventoryResults = searchResults?.inventory ?? []
  const customerResults = searchResults?.customers ?? []
  const vehicleResults = searchResults?.vehicles ?? []
  const orderResults = searchResults?.orders ?? []
  const hasSearch = query.length > 0

  const filteredQuickActions = React.useMemo(() => {
    if (!hasSearch) return quickActions
    const lower = query.toLowerCase()
    return quickActions
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.label.toLowerCase().includes(lower) ||
            item.description.toLowerCase().includes(lower),
        ),
      }))
      .filter((section) => section.items.length > 0)
  }, [hasSearch, query])

  const hasAnyResults =
    filteredQuickActions.length > 0 ||
    customerResults.length > 0 ||
    vehicleResults.length > 0 ||
    orderResults.length > 0 ||
    inventoryResults.length > 0

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Global Search"
      description="Jump to a part, customer, vehicle, job, or command."
      shouldFilter={false}
    >
      <CommandInput
        aria-label="Search parts, customers, vehicles, jobs, or commands"
        placeholder="Search parts, customers, vehicles, jobs…"
        value={search}
        onValueChange={setSearch}
      />

      <CommandList className="max-h-[420px] overflow-y-auto overflow-x-hidden px-1 pb-2">
        {!hasAnyResults && !isFetching ? (
          <CommandEmpty>
            {hasSearch
              ? `No parts, customers, vehicles, jobs, or commands match “${truncatedQuery}”.`
              : 'Start typing to search parts, customers, vehicles, jobs, or commands.'}
          </CommandEmpty>
        ) : null}

        {filteredQuickActions.map((section, sectionIndex) => (
          <React.Fragment key={section.heading}>
            <CommandGroup heading={section.heading}>
              {section.items.map((action) => {
                const Icon = action.icon

                return (
                  <CommandItem
                    key={action.href}
                    value={`${action.label} ${action.description}`}
                    onSelect={() => handleNavigate(action.href)}
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

            {sectionIndex === 0 ? <CommandSeparator /> : null}
          </React.Fragment>
        ))}

        {hasSearch ? (
          <>
            {error ? (
              <div className={cn('px-2 py-6 text-sm text-destructive')}>
                Search is temporarily unavailable.
              </div>
            ) : null}

            {isFetching ? (
              <div className="px-2 py-3 text-xs text-slate-500">Searching…</div>
            ) : null}

            {customerResults.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Customers">
                  {customerResults.map((customer) => {
                    const isCompany = customer.type === 'COMPANY'
                    const CustomerIcon = isCompany ? Building2 : UserRound
                    const displayName = isCompany
                      ? (customer.company_name || `${customer.first_name} ${customer.last_name}`.trim())
                      : `${customer.first_name} ${customer.last_name}`.trim()
                    const contactDetails = [customer.email, customer.phone].filter(Boolean).join(' • ')

                    return (
                      <CommandItem
                        key={customer.id}
                        value={`${displayName} ${customer.company_name ?? ''} ${customer.first_name} ${customer.last_name} ${customer.email ?? ''} ${customer.phone ?? ''}`}
                        onSelect={() => handleNavigate(`/customers/${customer.id}`)}
                      >
                        <CustomerIcon aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{displayName}</span>
                          {contactDetails ? (
                            <span className="truncate text-xs text-muted-foreground">{contactDetails}</span>
                          ) : null}
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </>
            ) : null}

            {vehicleResults.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Vehicles">
                  {vehicleResults.map((vehicle) => {
                    const makeModel = `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim()
                    const displayTitle = vehicle.plate || makeModel
                    const subtitle = vehicle.plate
                      ? `${makeModel}${vehicle.vin ? ` • VIN: ${vehicle.vin}` : ''}`
                      : (vehicle.vin ? `VIN: ${vehicle.vin}` : '')

                    return (
                      <CommandItem
                        key={vehicle.id}
                        value={`${vehicle.plate ?? ''} ${vehicle.make} ${vehicle.model} ${vehicle.vin ?? ''} ${vehicle.year}`}
                        onSelect={() => handleNavigate(`/vehicles/${vehicle.id}`)}
                      >
                        <Car aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{displayTitle}</span>
                          {subtitle ? (
                            <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
                          ) : null}
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </>
            ) : null}

            {orderResults.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Workshop orders">
                  {orderResults.map((order) => {
                    const customerName = getWorkshopCustomerDisplayName(order)
                    const vehicleSummary = order.vehicle
                      ? `${order.vehicle.make} ${order.vehicle.model}${order.vehicle.plate ? ` (${order.vehicle.plate})` : ''}`
                      : ''
                    const subtitle = [customerName, vehicleSummary].filter(Boolean).join(' • ')

                    return (
                      <CommandItem
                        key={order.id}
                        value={`${order.order_number ?? order.id} ${customerName} ${vehicleSummary}`}
                        onSelect={() => handleNavigate(`/workshop/orders/${order.id}`)}
                      >
                        <Wrench aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{order.order_number ?? order.id}</span>
                          {subtitle ? (
                            <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
                          ) : null}
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
            ) : null}

            {inventoryResults.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Inventory">
                  {inventoryResults.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${item.sku} ${item.name} ${item.brand}`}
                      onSelect={() =>
                        handleNavigate(`/inventory/${item.id}/ledger?sku=${encodeURIComponent(item.sku)}`)
                      }
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
            ) : null}
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
