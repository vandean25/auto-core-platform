import { Plus, Search, Trash2 } from "lucide-react"

import type { InvoiceEditorItem } from "@/hooks/useInvoiceEditor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface InvoiceLineItemsTableProps {
  items: InvoiceEditorItem[]
  onUpdateItem: (index: number, changes: Partial<InvoiceEditorItem>) => void
  onRemoveItem: (index: number) => void
  onOpenPartSearch: (index: number) => void
  onAddItem: () => void
}

export function InvoiceLineItemsTable({
  items,
  onUpdateItem,
  onRemoveItem,
  onOpenPartSearch,
  onAddItem,
}: InvoiceLineItemsTableProps) {
  return (
    <div className="mb-12">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]"></TableHead>
            <TableHead className="w-[40%]">Item / Description</TableHead>
            <TableHead className="w-[100px]">Qty</TableHead>
            <TableHead className="w-[120px]">Price (€)</TableHead>
            <TableHead className="w-[100px]">Tax (%)</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={item.tempId}>
              <TableCell className="text-center text-muted-foreground">
                {index + 1}
              </TableCell>
              <TableCell>
                <div className="relative">
                  <Input
                    value={item.description}
                    onChange={(e) => onUpdateItem(index, { description: e.target.value })}
                    placeholder="Service or Item Name"
                    className="pr-10"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full text-muted-foreground hover:text-foreground"
                    aria-label={`Search part for line ${index + 1}`}
                    onClick={() => onOpenPartSearch(index)}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min="0"
                  value={item.quantity}
                  onChange={(e) => onUpdateItem(index, { quantity: parseFloat(e.target.value) || 0 })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unit_price}
                  onChange={(e) => onUpdateItem(index, { unit_price: parseFloat(e.target.value) || 0 })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={item.tax_rate}
                  onChange={(e) => onUpdateItem(index, { tax_rate: parseFloat(e.target.value) || 0 })}
                />
              </TableCell>
              <TableCell className="text-right font-medium">
                €{((item.quantity * item.unit_price) * (1 + item.tax_rate / 100)).toFixed(2)}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" aria-label={`Remove line ${index + 1}`} onClick={() => onRemoveItem(index)}>
                  <Trash2 className="h-4 w-4 text-destructive opacity-50 hover:opacity-100" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Button variant="outline" className="mt-4" onClick={onAddItem}>
        <Plus className="mr-2 h-4 w-4" /> Add Line Item
      </Button>
    </div>
  )
}
