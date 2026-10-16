import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

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
} from './GlobalSearchResultGroups.i18n'
import { truncate } from './global-search-format'
import { filterQuickActionSections } from './global-search-quick-actions'
import { getGlobalSearchQuickActionSections } from './global-search-quick-actions-data'

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { t } = useTranslation('nav')
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
    () => filterQuickActionSections(getGlobalSearchQuickActionSections(), query),
    [query, t],
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
      title={t('globalSearch.title')}
      description={t('globalSearch.description')}
      shouldFilter={false}
    >
      <CommandInput
        aria-label={t('globalSearch.inputLabel')}
        placeholder={t('globalSearch.placeholder')}
        value={search}
        onValueChange={setSearch}
      />

      <CommandList className="max-h-[420px] overflow-y-auto overflow-x-hidden px-1 pb-2">
        {!hasAnyResults && !isFetching && !error ? (
          <CommandEmpty>
            {hasSearch ? (
              <>
                <p>{t('globalSearch.emptyNoMatch', { query: truncatedQuery })}</p>
                <p className="mt-1 text-xs text-slate-500">{t('globalSearch.emptyHint')}</p>
              </>
            ) : (
              t('globalSearch.emptyIdle')
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
              <div className={cn('px-2 py-6 text-sm text-destructive')}>{t('globalSearch.unavailable')}</div>
            ) : null}

            {isFetching ? (
              <div className="px-2 py-3 text-xs text-slate-500">{t('globalSearch.searching')}</div>
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
