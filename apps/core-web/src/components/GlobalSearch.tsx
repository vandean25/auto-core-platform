import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ClipboardList,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings,
  Truck,
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

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const [search, setSearch] = React.useState('')
  const query = search.trim()
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

  const inventoryResults = searchResults?.data ?? []
  const hasSearch = query.length > 0

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Global Search"
      description="Search inventory and jump to core workflows."
    >
      <CommandInput
        aria-label="Search inventory and commands"
        placeholder="Search inventory or commands…"
        value={search}
        onValueChange={setSearch}
      />

      <CommandList className="max-h-[420px] overflow-y-auto overflow-x-hidden px-1 pb-2">
        <CommandEmpty>
          {hasSearch ? `No inventory or commands match “${query}”.` : 'Start typing to search inventory and commands.'}
        </CommandEmpty>

        {quickActions.map((section, sectionIndex) => (
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
            <CommandSeparator />
            <CommandGroup heading="Inventory Results">
              {error ? (
                <div className={cn('px-2 py-6 text-sm text-destructive')}>
                  Search is temporarily unavailable.
                </div>
              ) : isFetching ? (
                <div className="px-2 py-6 text-sm text-slate-500">Searching inventory…</div>
              ) : inventoryResults.length > 0 ? (
                inventoryResults.map((item) => (
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
                ))
              ) : (
                <div className="px-2 py-6 text-sm text-slate-500">
                  No inventory items match “{query}”.
                </div>
              )}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
