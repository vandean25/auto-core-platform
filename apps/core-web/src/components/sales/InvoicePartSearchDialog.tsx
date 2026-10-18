import { useTranslation } from 'react-i18next'
import type { InventoryItem } from "@/api/types"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

interface InvoicePartSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  search: string
  onSearchChange: (value: string) => void
  items: InventoryItem[]
  onSelect: (item: InventoryItem) => void
}

export function InvoicePartSearchDialog({
  open,
  onOpenChange,
  search,
  onSearchChange,
  items,
  onSelect,
}: InvoicePartSearchDialogProps) {
  const { t } = useTranslation('sales')

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('invoiceEditor.partSearch.title')}
      description={t('invoiceEditor.partSearch.description')}
    >
      <CommandInput
        aria-label={t('invoiceEditor.partSearch.searchAria')}
        placeholder={t('invoiceEditor.partSearch.placeholder')}
        value={search}
        onValueChange={onSearchChange}
      />
      <CommandList>
        <CommandEmpty>{t('invoiceEditor.partSearch.empty')}</CommandEmpty>
        <CommandGroup heading={t('invoiceEditor.partSearch.group')}>
          {items.map((part: InventoryItem) => (
            <CommandItem key={part.id} value={part.name + ' ' + part.sku} onSelect={() => onSelect(part)}>
              <div className="flex flex-col">
                <span className="font-medium">{part.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t('invoiceEditor.partSearch.stockLine', {
                    sku: part.sku,
                    quantity: part.quantity_available,
                    price: part.price,
                  })}
                </span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
