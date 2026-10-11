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
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search Inventory"
      description="Find parts and add them to the invoice."
    >
      <CommandInput
        aria-label="Search inventory"
        placeholder="Search inventory…"
        value={search}
        onValueChange={onSearchChange}
      />
      <CommandList>
        <CommandEmpty>No parts found.</CommandEmpty>
        <CommandGroup heading="Inventory">
          {items.map((part: InventoryItem) => (
            <CommandItem key={part.id} value={part.name + ' ' + part.sku} onSelect={() => onSelect(part)}>
              <div className="flex flex-col">
                <span className="font-medium">{part.name}</span>
                <span className="text-xs text-muted-foreground">{part.sku} • Stock: {part.quantity_available} • €{part.price}</span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
