import * as React from 'react'
import { useNavigate } from 'react-router-dom'

import { useGlobalSearch } from '@/hooks/useGlobalSearch'
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import {
  CustomerResultsGroup,
  InventoryResultsGroup,
  OrderResultsGroup,
  QuickActionGroup,
  VehicleResultsGroup,
} from './global-search/GlobalSearchResultGroups'
import { truncate } from './global-search/global-search-format'
import {
  filterQuickActionSections,
  quickActionSections,
} from './global-search/global-search-quick-actions'

interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const NO_RESULT_HINT = 'Try a full name (first and last), a plate, a VIN or an order number.'

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

  const filteredQuickActions = React.useMemo(
    () => filterQuickActionSections(quickActionSections, query),
    [query],
  )

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
        {!hasAnyResults && !isFetching && !error ? (
          <CommandEmpty>
            {hasSearch ? (
              <>
                <p>{`No parts, customers, vehicles, jobs, or commands match “${truncatedQuery}”.`}</p>
                <p className="mt-1 text-xs text-slate-500">{NO_RESULT_HINT}</p>
              </>
            ) : (
              'Start typing to search parts, customers, vehicles, jobs, or commands.'
            )}
          </CommandEmpty>
        ) : null}

        {filteredQuickActions.map((section, sectionIndex) => (
          <QuickActionGroup
            key={section.heading}
            section={section}
            showSeparator={sectionIndex === 0}
            onSelect={handleNavigate}
          />
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

            <CustomerResultsGroup customers={customerResults} onSelect={handleNavigate} />
            <VehicleResultsGroup vehicles={vehicleResults} onSelect={handleNavigate} />
            <OrderResultsGroup orders={orderResults} onSelect={handleNavigate} />
            <InventoryResultsGroup items={inventoryResults} onSelect={handleNavigate} />
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
