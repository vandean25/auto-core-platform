import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { InventoryItem } from '@/api/types'
import { useInventory } from '@/api/inventory'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatCurrency } from '@/lib/utils'

/** Popover that searches the parts inventory and hands the picked part back. */
export function SalesOrderItemSearch({ onPick }: { onPick: (item: InventoryItem) => void }) {
  const { t } = useTranslation('sales')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { data: inventory } = useInventory({ search: query, pageSize: 10 })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Plus className="mr-2 h-4 w-4" /> {t('orders.create.addLine')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('orders.create.searchPartsBySku')}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{t('orders.create.noParts')}</CommandEmpty>
            <CommandGroup>
              {inventory?.data.map((item) => (
                <CommandItem
                  key={item.id}
                  onSelect={() => {
                    onPick(item)
                    setOpen(false)
                  }}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{item.sku}</span>
                    <span className="text-xs text-muted-foreground">{item.name}</span>
                  </div>
                  <div className="ml-auto font-medium">{formatCurrency(item.price)}</div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
