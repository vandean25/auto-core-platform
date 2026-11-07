import * as React from "react"
import { Check, ChevronsUpDown, Loader2Icon } from "lucide-react"
import { useTranslation } from 'react-i18next'

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useCustomers } from "@/api/customers"
import type { Customer } from "@/api/types"

interface CustomerSearchProps {
    value?: Customer | null
    onChange: (customer: Customer | null) => void
    /** A server-confirmed write is in flight: only this button shows it, and it cannot be used again meanwhile. */
    pending?: boolean
}

const getCustomerName = (customer: Customer) => {
    if (customer.type === 'COMPANY') return customer.company_name
    return `${customer.first_name} ${customer.last_name}`
}

export function CustomerSearch({ value, onChange, pending = false }: CustomerSearchProps) {
  const { t } = useTranslation('customers')
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const { data: customersResponse } = useCustomers({
    page: 1,
    pageSize: 10,
    search: search || undefined,
    filters: [],
  }, {
    enabled: open,
  })
  const customers: Customer[] = Array.isArray(customersResponse)
    ? customersResponse
    : Array.isArray(customersResponse?.data)
      ? customersResponse.data
      : []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-busy={pending}
          disabled={pending}
          className="w-full justify-between max-sm:min-h-11"
        >
          {value ? getCustomerName(value) : t('search.selectPlaceholder')}
          {pending ? (
            <Loader2Icon aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t('search.searchPlaceholder')} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{t('search.empty')}</CommandEmpty>
            <CommandGroup>
              {customers.map((customer: Customer) => (
                <CommandItem
                  key={customer.id}
                  value={customer.id}
                  onSelect={() => {
                    onChange(customer)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value?.id === customer.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {getCustomerName(customer)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
