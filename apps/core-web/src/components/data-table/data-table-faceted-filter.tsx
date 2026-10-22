import type { LegacyColumn as Column } from '@tanstack/react-table/legacy'
import { Check, PlusCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { splitFilterValue, type DataTableFilterMeta } from './data-table-column-meta'

interface DataTableFacetedFilterProps<TData extends object> {
  column: Column<TData, unknown>
  filter: Extract<DataTableFilterMeta, { type: 'faceted' }>
}

export function DataTableFacetedFilter<TData extends object>({ column, filter }: DataTableFacetedFilterProps<TData>) {
  const { t } = useTranslation('common')
  const selected = new Set(splitFilterValue(column.getFilterValue()))

  const toggle = (value: string) => {
    const next = new Set(selected)
    if (!next.delete(value)) next.add(value)
    column.setFilterValue(next.size > 0 ? [...next].join(',') : undefined)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <PlusCircle className="mr-2 h-4 w-4" />
          {filter.title}
          {selected.size > 0 ? (
            <Badge variant="secondary" className="ml-2 rounded-sm px-1 font-normal">
              {t('dataTable.filters.selected', { count: selected.size })}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={filter.title} />
          <CommandList>
            <CommandEmpty>{t('dataTable.filters.noMatches')}</CommandEmpty>
            <CommandGroup>
              {filter.options.map((option) => {
                const isSelected = selected.has(option.value)
                return (
                  <CommandItem key={option.value} value={option.label} onSelect={() => toggle(option.value)}>
                    <span
                      className={cn(
                        'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                        isSelected ? 'bg-primary text-primary-foreground' : 'opacity-50',
                      )}
                    >
                      {isSelected ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span>{option.label}</span>
                    {isSelected ? <span className="sr-only">{t('dataTable.filters.itemSelected')}</span> : null}
                    {option.count !== undefined ? (
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{option.count}</span>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => column.setFilterValue(undefined)} className="justify-center text-center">
                    {t('dataTable.filters.clear')}
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
