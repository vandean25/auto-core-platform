import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useCustomers } from '@/api/customers'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getCustomerListRowLabel } from '@/features/actions/customer-row-actions'
import { cn } from '@/lib/utils'

const SEARCH_DEBOUNCE_MS = 300
const PICKER_PAGE_SIZE = 10

type EstimateCustomerPickerProps = {
  customerId: string
  customerName: string
  onChange: (customer: { id: string; name: string } | null) => void
}

/** Searches customers on the server while typing; the chosen one is shown by name and can be cleared. */
export function EstimateCustomerPicker({ customerId, customerName, onChange }: EstimateCustomerPickerProps) {
  const { t } = useTranslation('workshop')
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(input.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [input])

  const { data, isLoading } = useCustomers(
    { page: 1, pageSize: PICKER_PAGE_SIZE, search: search || undefined, filters: [] },
    { enabled: open },
  )
  const customers = data?.data ?? []

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={t('estimateList.filters.customer')}
            className="min-w-0 flex-1 justify-between sm:w-56 sm:flex-none"
          >
            <span className="truncate">{customerId ? customerName : t('estimateList.filters.customerAll')}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              value={input}
              onValueChange={setInput}
              placeholder={t('estimateList.filters.customerSearch')}
            />
            <CommandList>
              <CommandEmpty>
                {isLoading ? t('estimateList.filters.customerLoading') : t('estimateList.filters.customerEmpty')}
              </CommandEmpty>
              <CommandGroup>
                {customers.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    value={customer.id}
                    onSelect={() => {
                      onChange({ id: customer.id, name: getCustomerListRowLabel(customer) })
                      setOpen(false)
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', customer.id === customerId ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{getCustomerListRowLabel(customer)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {customerId ? (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={t('estimateList.filters.customerClear')}
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  )
}
