import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { parseNumber } from '../bill-utils'
import type { PurchaseBillFormModel } from '../form-model'

export function PurchaseBillLineItemEditor({ form }: { form: PurchaseBillFormModel }) {
  const { setShowSuggestions } = form
  const quickEntryRef = useRef<HTMLDivElement | null>(null)
  const itemInputRef = useRef<HTMLInputElement | null>(null)
  const qtyInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!quickEntryRef.current) return
      const target = event.target as Node | null
      if (target && !quickEntryRef.current.contains(target)) {
        setShowSuggestions(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [setShowSuggestions])

  return (
    <div className="space-y-3">
      <div ref={quickEntryRef} className="border rounded-xl bg-muted/40 px-3 py-2">
        <div className="grid grid-cols-[1fr_70px_auto] gap-2">
          <div className="relative">
            <Input
              ref={itemInputRef}
              value={form.searchQuery}
              onChange={(event) => {
                if (form.stagedItem) form.setStagedItem(null)
                form.setSearchQuery(event.target.value)
              }}
              onFocus={() => form.setShowSuggestions(true)}
              placeholder={form.vendorId ? 'Search part number or name...' : 'Select a vendor first'}
              className="h-8 text-xs"
              disabled={!form.vendorId}
            />
            {form.showSuggestions && form.debouncedSearchQuery && (
              <div className="absolute left-0 right-0 top-full z-[5] mt-1 rounded-md border bg-popover shadow-md">
                <Command shouldFilter={false}>
                  <CommandList className="max-h-64">
                    {form.filteredInventory.length === 0 && (
                      <CommandEmpty>No matching items.</CommandEmpty>
                    )}
                    {form.filteredInventory.length > 0 && (
                      <CommandGroup heading="Parts">
                        {form.filteredInventory.map((item) => (
                          <CommandItem
                            key={item.id}
                            onSelect={() => {
                              form.stagePart(item)
                              requestAnimationFrame(() => {
                                qtyInputRef.current?.focus()
                                qtyInputRef.current?.select()
                              })
                            }}
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-medium">{item.sku}</div>
                                <div className="truncate text-xs text-muted-foreground">{item.name}</div>
                              </div>
                              <div className="shrink-0 text-right text-xs text-muted-foreground">
                                <div>{formatCurrency(item.price)}</div>
                                <div>Stock: {item.quantity_available}</div>
                              </div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </div>
            )}
          </div>
          <Input
            ref={qtyInputRef}
            value={form.newQty}
            onChange={(event) => form.setNewQty(event.target.value)}
            placeholder="Qty"
            className="h-8 text-xs text-right"
            disabled={!form.stagedItem}
          />
          <Button
            type="button"
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => {
              if (form.confirmAddItem()) {
                requestAnimationFrame(() => {
                  itemInputRef.current?.focus()
                })
              }
            }}
            disabled={!form.stagedItem}
          >
            + Add
          </Button>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[48px]">#</TableHead>
              <TableHead className="w-[38%]">Description</TableHead>
              <TableHead className="w-[90px]">Qty</TableHead>
              <TableHead className="w-[110px]">Unit Cost</TableHead>
              <TableHead className="w-[90px]">Tax (%)</TableHead>
              <TableHead className="text-right">Line Total</TableHead>
              <TableHead className="w-[48px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {form.lines.map((line, index) => {
              const lineNet = line.quantity * line.unitCost
              const lineTax = lineNet * (line.taxRate / 100)
              const lineTotal = lineNet + lineTax
              return (
                <TableRow key={line.tempId}>
                  <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Input
                        value={line.description}
                        onChange={(event) =>
                          form.updateLine(line.tempId, { description: event.target.value })
                        }
                      />
                      {line.source === 'receipt' && line.receiptNumber && (
                        <Badge variant="outline">Imported from {line.receiptNumber}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={line.quantity}
                      onChange={(event) =>
                        form.updateLine(line.tempId, { quantity: parseNumber(event.target.value) })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={line.unitCost}
                      onChange={(event) =>
                        form.updateLine(line.tempId, { unitCost: parseNumber(event.target.value) })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={line.taxRate}
                      onChange={(event) =>
                        form.updateLine(line.tempId, { taxRate: parseNumber(event.target.value) })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(lineTotal)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void form.removeLine(line.tempId)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive opacity-60 hover:opacity-100" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
