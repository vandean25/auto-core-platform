import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { CircleDollarSign, Clock3, Package, Trash2, X } from 'lucide-react'
import { useCatalogSearch } from '@/api/workshop'
import type { CatalogPartSearchItem, LaborOperationSearchItem } from '@/api/types'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type TaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'DONE'
type LineItemType = 'LABOR' | 'PART'

interface TaskLineItem {
  id: string
  type: LineItemType
  itemNo: string
  description: string
  qty: number
  unitPrice: number
}

interface RepairTask {
  id: string
  title: string
  done: boolean
  status: TaskStatus
  lineItems: TaskLineItem[]
  mechanicNotes: string
}

interface TaskDetailPanelProps {
  workshopOrderId: string
  task: RepairTask
  onTaskStatusChange: (taskId: string, status: TaskStatus) => void
  onTaskLineItemsChange: (taskId: string, items: TaskLineItem[]) => void
  onTaskMechanicNotesChange: (taskId: string, notes: string) => void
  onTaskDelete?: (taskId: string) => void
  canDeleteTask?: boolean
  isDeletingTask?: boolean
  readOnly?: boolean
  onClose: () => void
}

interface StagedLineItemDraft {
  type: LineItemType
  itemNo: string
  description: string
  unitPrice: number
  label: string
}

const STABLE_EMPTY_ITEMS: TaskLineItem[] = []
const STABLE_EMPTY_LABOR: LaborOperationSearchItem[] = []
const STABLE_EMPTY_PARTS: CatalogPartSearchItem[] = []

export function TaskDetailPanel({
  workshopOrderId,
  task,
  onTaskStatusChange,
  onTaskLineItemsChange,
  onTaskMechanicNotesChange,
  onTaskDelete,
  canDeleteTask = false,
  isDeletingTask = false,
  readOnly = false,
  onClose,
}: TaskDetailPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [newQty, setNewQty] = useState('1')
  const [stagedLineItem, setStagedLineItem] = useState<StagedLineItemDraft | null>(null)
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null)
  const [poppedQtyRowId, setPoppedQtyRowId] = useState<string | null>(null)
  const itemInputRef = useRef<HTMLInputElement | null>(null)
  const qtyInputRef = useRef<HTMLInputElement | null>(null)
  const rowFlashTimeoutRef = useRef<number | null>(null)
  const qtyPopTimeoutRef = useRef<number | null>(null)

  const taskTitle = task.title
  const status = task.status
  const items = task.lineItems ?? STABLE_EMPTY_ITEMS
  const partsSubtotal = items
    .filter((item) => item.type === 'PART')
    .reduce((acc, item) => acc + item.qty * item.unitPrice, 0)
  const laborSubtotal = items
    .filter((item) => item.type === 'LABOR')
    .reduce((acc, item) => acc + item.qty * item.unitPrice, 0)
  const taskTotal = partsSubtotal + laborSubtotal
  const queryForSearch = stagedLineItem ? '' : debouncedSearchQuery
  const { data: catalogSearch, isFetching: isSearchingCatalog } = useCatalogSearch(
    queryForSearch,
    workshopOrderId,
    true,
  )
  const laborSuggestions = catalogSearch?.labor ?? STABLE_EMPTY_LABOR
  const partSuggestions = catalogSearch?.parts ?? STABLE_EMPTY_PARTS

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim())
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [searchQuery])

  useEffect(() => {
    return () => {
      if (rowFlashTimeoutRef.current) {
        window.clearTimeout(rowFlashTimeoutRef.current)
      }
      if (qtyPopTimeoutRef.current) {
        window.clearTimeout(qtyPopTimeoutRef.current)
      }
    }
  }, [])

  function clearQuickEntry() {
    setSearchQuery('')
    setDebouncedSearchQuery('')
    setStagedLineItem(null)
    requestAnimationFrame(() => itemInputRef.current?.focus())
  }

  function triggerMergeFeedback(lineItemId: string) {
    if (rowFlashTimeoutRef.current) {
      window.clearTimeout(rowFlashTimeoutRef.current)
    }
    if (qtyPopTimeoutRef.current) {
      window.clearTimeout(qtyPopTimeoutRef.current)
    }
    setHighlightedRowId(lineItemId)
    setPoppedQtyRowId(lineItemId)
    rowFlashTimeoutRef.current = window.setTimeout(() => {
      setHighlightedRowId(null)
    }, 500)
    qtyPopTimeoutRef.current = window.setTimeout(() => {
      setPoppedQtyRowId(null)
    }, 240)
  }

  function addOrMergeLineItem(next: TaskLineItem) {
    if (readOnly) return
    const existing = items.find(
      (lineItem) =>
        lineItem.type === next.type &&
        lineItem.itemNo.toLowerCase() === next.itemNo.toLowerCase(),
    )

    if (!existing) {
      onTaskLineItemsChange(task.id, [...items, next])
    } else {
      onTaskLineItemsChange(
        task.id,
        items.map((lineItem) =>
          lineItem.id === existing.id
            ? { ...lineItem, qty: lineItem.qty + next.qty }
            : lineItem,
        ),
      )
      triggerMergeFeedback(existing.id)
    }

    setNewQty('1')
    clearQuickEntry()
  }

  function stageLaborOperation(operation: LaborOperationSearchItem) {
    setStagedLineItem({
      type: 'LABOR',
      itemNo: operation.code,
      description: operation.description,
      unitPrice: operation.hourlyRate,
      label: `${operation.code} - ${operation.description}`,
    })
    setSearchQuery(`${operation.code} - ${operation.description}`)
    setDebouncedSearchQuery('')
    setNewQty(String(operation.standardAw))
    requestAnimationFrame(() => {
      qtyInputRef.current?.focus()
      qtyInputRef.current?.select()
    })
  }

  function stagePart(part: CatalogPartSearchItem) {
    setStagedLineItem({
      type: 'PART',
      itemNo: part.supplierPartNumber,
      description: `${part.brand} - ${part.description}`,
      unitPrice: part.retailPrice ?? 0,
      label: `${part.supplierPartNumber} - ${part.brand} - ${part.description}`,
    })
    setSearchQuery(`${part.supplierPartNumber} - ${part.brand} - ${part.description}`)
    setDebouncedSearchQuery('')
    setNewQty('1')
    requestAnimationFrame(() => {
      qtyInputRef.current?.focus()
      qtyInputRef.current?.select()
    })
  }

  function stageFromKeyboard() {
    const firstLabor = laborSuggestions[0]
    if (firstLabor) {
      stageLaborOperation(firstLabor)
      return
    }
    const firstPart = partSuggestions[0]
    if (firstPart) {
      stagePart(firstPart)
    }
  }

  function confirmStagedItem() {
    if (readOnly || !stagedLineItem) return
    const qty = Number(newQty)
    const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1
    const next: TaskLineItem = {
      id: `li-${task.id}-${items.length + 1}`,
      type: stagedLineItem.type,
      itemNo: stagedLineItem.itemNo,
      description: stagedLineItem.description,
      qty: safeQty,
      unitPrice: stagedLineItem.unitPrice,
    }
    addOrMergeLineItem(next)
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (stagedLineItem) {
      qtyInputRef.current?.focus()
      qtyInputRef.current?.select()
      return
    }
    if (!isSuggestionStateReady) return
    stageFromKeyboard()
  }

  function handleQtyKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    confirmStagedItem()
  }

  function updatePartQuantity(lineItemId: string, nextQty: number) {
    if (readOnly || !Number.isFinite(nextQty) || nextQty <= 0) return
    const target = items.find((lineItem) => lineItem.id === lineItemId)
    if (!target || target.type !== 'PART' || target.qty === nextQty) return

    onTaskLineItemsChange(
      task.id,
      items.map((lineItem) =>
        lineItem.id === lineItemId ? { ...lineItem, qty: nextQty } : lineItem,
      ),
    )
  }

  const normalizedSearchQuery = searchQuery.trim()
  const showSuggestions = !stagedLineItem && normalizedSearchQuery.length >= 2
  const hasResults = laborSuggestions.length > 0 || partSuggestions.length > 0
  const isSuggestionStateReady =
    normalizedSearchQuery.length >= 2 &&
    debouncedSearchQuery === normalizedSearchQuery &&
    !isSearchingCatalog &&
    hasResults

  return (
    <Card className="border-primary/20 shadow-lg">
      <CardHeader className="pb-4 border-b">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="text-lg font-semibold tracking-tight truncate">{taskTitle}</h3>
              <Badge variant={status === 'DONE' ? 'secondary' : 'outline'} className="shrink-0">
                {status.replace('_', ' ')}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Labor, parts, and mechanic notes for this task
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Select
              value={status}
              disabled={readOnly}
              onValueChange={(v) => {
                const nextStatus = v as TaskStatus
                if (nextStatus !== task.status) {
                  onTaskStatusChange(task.id, nextStatus)
                }
              }}
            >
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NOT_STARTED">Not Started</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="WAITING_PARTS">Waiting Parts</SelectItem>
                <SelectItem value="DONE">Done</SelectItem>
              </SelectContent>
            </Select>

            {onTaskDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onTaskDelete(task.id)}
                disabled={!canDeleteTask || isDeletingTask}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete task</span>
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2"
              onClick={onClose}
              aria-label="Close task panel"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <Tabs defaultValue="labor-parts" className="w-full">
          <TabsList className="grid w-full grid-cols-2 lg:w-auto lg:inline-grid">
            <TabsTrigger value="labor-parts">Labor & Parts</TabsTrigger>
            <TabsTrigger value="mechanic-notes">Mechanic Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="labor-parts" className="mt-4 space-y-4">
            {/* Quick Add Row */}
            {!readOnly && (
              <div className="border rounded-xl bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Input
                      ref={itemInputRef}
                      value={searchQuery}
                      onChange={(e) => {
                        if (stagedLineItem) {
                          setStagedLineItem(null)
                        }
                        setSearchQuery(e.target.value)
                      }}
                      onKeyDown={handleSearchKeyDown}
                      placeholder="Search labor or part number..."
                      className="h-9"
                    />
                    {showSuggestions && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border bg-popover shadow-md">
                        <Command shouldFilter={false}>
                          <CommandList className="max-h-64">
                            {!isSearchingCatalog && !hasResults && (
                              <CommandEmpty>No compatible catalog items found.</CommandEmpty>
                            )}
                            {laborSuggestions.length > 0 && (
                              <CommandGroup heading="Labor">
                                {laborSuggestions.map((operation) => (
                                  <CommandItem
                                    key={operation.id}
                                    value={`${operation.code} ${operation.description}`}
                                    onSelect={() => stageLaborOperation(operation)}
                                  >
                                    <div className="flex w-full items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium">{operation.code}</div>
                                        <div className="truncate text-xs text-muted-foreground">
                                          {operation.description}
                                        </div>
                                      </div>
                                      <div className="shrink-0 text-xs text-muted-foreground">
                                        {operation.standardAw} AW
                                      </div>
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            )}
                            {partSuggestions.length > 0 && (
                              <CommandGroup heading="Parts">
                                {partSuggestions.map((part) => (
                                  <CommandItem
                                    key={part.id}
                                    value={`${part.supplierPartNumber} ${part.description}`}
                                    onSelect={() => stagePart(part)}
                                  >
                                    <div className="flex w-full items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium">
                                          {part.supplierPartNumber}
                                          {part.oemNumber ? ` - OEM ${part.oemNumber}` : ''}
                                        </div>
                                        <div className="truncate text-xs text-muted-foreground">
                                          {part.brand} - {part.description}
                                        </div>
                                      </div>
                                      <div className="shrink-0 text-right text-xs text-muted-foreground">
                                        <div>{formatCurrency(part.retailPrice ?? 0)}</div>
                                        <div>Stock: {part.quantityOnHand}</div>
                                      </div>
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            )}
                            {isSearchingCatalog && (
                              <div className="px-2 py-2 text-xs text-muted-foreground">
                                Searching...
                              </div>
                            )}
                          </CommandList>
                        </Command>
                      </div>
                    )}
                  </div>

                  <Input
                    ref={qtyInputRef}
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    onKeyDown={handleQtyKeyDown}
                    placeholder="Qty"
                    className="h-9 w-20 text-right"
                    disabled={readOnly || !stagedLineItem}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 px-4"
                    onClick={confirmStagedItem}
                    disabled={readOnly || !stagedLineItem}
                  >
                    + Add
                  </Button>
                </div>
              </div>
            )}

            {/* Line Items Table */}
            <div className="border rounded-xl overflow-hidden">
              <div className="max-h-[320px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[80px] text-xs">Type</TableHead>
                      <TableHead className="text-xs">Item No.</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="w-[60px] text-xs text-right">Qty</TableHead>
                      <TableHead className="w-[100px] text-xs text-right">Unit Price</TableHead>
                      <TableHead className="w-[100px] text-xs text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                          No labor or parts added yet. Use the search above to add items.
                        </TableCell>
                      </TableRow>
                    )}
                    {items.map((item) => (
                      <TableRow
                        key={item.id}
                        className={`transition-colors duration-500 ${
                          highlightedRowId === item.id
                            ? 'bg-primary/10'
                            : ''
                        }`}
                      >
                        <TableCell>
                          <Badge variant={item.type === 'LABOR' ? 'secondary' : 'outline'} className="text-xs">
                            {item.type === 'LABOR' ? 'Labor' : 'Part'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium font-mono text-xs">{item.itemNo}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{item.description}</TableCell>
                        <TableCell className="text-right">
                          {item.type === 'PART' && !readOnly ? (
                            <motion.div
                              animate={
                                poppedQtyRowId === item.id
                                  ? { scale: [1, 1.2, 1] }
                                  : { scale: 1 }
                              }
                              transition={{ duration: 0.24, ease: 'easeOut' }}
                              className="origin-center"
                            >
                              <Input
                                key={`${item.id}-${item.qty}`}
                                defaultValue={String(item.qty)}
                                inputMode="decimal"
                                className="h-7 w-14 text-right text-xs"
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.currentTarget.blur()
                                  }
                                }}
                                onBlur={(event) => {
                                  const parsedQty = Number(event.currentTarget.value)
                                  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
                                    event.currentTarget.value = String(item.qty)
                                    return
                                  }
                                  event.currentTarget.value = String(parsedQty)
                                  updatePartQuantity(item.id, parsedQty)
                                }}
                              />
                            </motion.div>
                          ) : (
                            <motion.span
                              animate={
                                poppedQtyRowId === item.id
                                  ? { scale: [1, 1.2, 1] }
                                  : { scale: 1 }
                              }
                              transition={{ duration: 0.24, ease: 'easeOut' }}
                              className="inline-block origin-center"
                            >
                              {item.qty}
                            </motion.span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell className="text-right font-medium text-sm">{formatCurrency(item.qty * item.unitPrice)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Totals Row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Package className="h-4 w-4" />
                  <span>Parts</span>
                </div>
                <div className="mt-1 text-lg font-semibold">{formatCurrency(partsSubtotal)}</div>
              </div>
              <div className="rounded-xl border bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="h-4 w-4" />
                  <span>Labor</span>
                </div>
                <div className="mt-1 text-lg font-semibold">{formatCurrency(laborSubtotal)}</div>
              </div>
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-primary/70">
                  <CircleDollarSign className="h-4 w-4" />
                  <span>Task Total</span>
                </div>
                <div className="mt-1 text-lg font-bold text-primary">{formatCurrency(taskTotal)}</div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="mechanic-notes" className="mt-4">
            <textarea
              className={`w-full min-h-[280px] rounded-xl border p-4 text-sm outline-none focus:ring-2 focus:ring-ring resize-none ${
                readOnly ? 'bg-muted/30' : ''
              }`}
              placeholder="Mechanic observations, measurements, and service notes..."
              defaultValue={task.mechanicNotes ?? ''}
              key={`mechanic-notes-${task.id}`}
              readOnly={readOnly}
              onBlur={(e) => {
                if (readOnly) return
                const nextNotes = e.currentTarget.value
                if (nextNotes !== (task.mechanicNotes ?? '')) {
                  onTaskMechanicNotesChange(task.id, nextNotes)
                }
              }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
