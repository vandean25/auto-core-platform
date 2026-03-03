import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { CircleDollarSign, Clock3, Package, X } from 'lucide-react'
import { useCatalogSearch } from '@/api/workshop'
import type { CatalogPartSearchItem, LaborOperationSearchItem } from '@/api/types'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
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
  Sheet,
  SheetContent,
  SheetHeader,
} from '@/components/ui/sheet'
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

interface TaskDetailDrawerProps {
  workshopOrderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  task: RepairTask | null
  onTaskStatusChange: (taskId: string, status: TaskStatus) => void
  onTaskLineItemsChange: (taskId: string, items: TaskLineItem[]) => void
  onTaskMechanicNotesChange: (taskId: string, notes: string) => void
  readOnly?: boolean
  variant?: 'drawer' | 'docked'
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

export function TaskDetailDrawer({
  workshopOrderId,
  open,
  onOpenChange,
  task,
  onTaskStatusChange,
  onTaskLineItemsChange,
  onTaskMechanicNotesChange,
  readOnly = false,
  variant = 'drawer',
}: TaskDetailDrawerProps) {
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

  const taskTitle = task?.title ?? 'Task Detail'
  const status = task?.status ?? 'IN_PROGRESS'
  const items = task?.lineItems ?? STABLE_EMPTY_ITEMS
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
    open,
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
    if (!task || readOnly) return
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
      label: `${operation.code} · ${operation.description}`,
    })
    setSearchQuery(`${operation.code} · ${operation.description}`)
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
      description: `${part.brand} · ${part.description}`,
      unitPrice: part.retailPrice ?? 0,
      label: `${part.supplierPartNumber} · ${part.brand} · ${part.description}`,
    })
    setSearchQuery(`${part.supplierPartNumber} · ${part.brand} · ${part.description}`)
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
    if (!task || readOnly || !stagedLineItem) return
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
    if (!task || readOnly || !Number.isFinite(nextQty) || nextQty <= 0) return
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
  const isDocked = variant === 'docked'

  const panelBody = (
    <motion.div
      key={task?.id ?? 'task-panel'}
      className="h-full flex flex-col"
      initial={{ opacity: 0, x: isDocked ? 12 : 0 }}
      animate={{ opacity: 1, x: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
      exit={{ opacity: 0, x: isDocked ? 12 : 0, transition: { duration: 0.16, ease: 'easeIn' } }}
    >
      <SheetHeader className="px-6 py-5 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-3 min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{taskTitle}</h2>
            <div className="w-[220px]">
              <Select
                value={status}
                disabled={readOnly}
                onValueChange={(v) => {
                  if (!task) return
                  const nextStatus = v as TaskStatus
                  if (nextStatus !== task.status) {
                    onTaskStatusChange(task.id, nextStatus)
                  }
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NOT_STARTED">Not Started</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="WAITING_PARTS">Waiting Parts</SelectItem>
                  <SelectItem value="DONE">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Task details, labor lines, parts, and mechanic notes.
            </p>
          </div>
          {isDocked && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Close task panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-hidden px-6 py-4">
        <Tabs defaultValue="labor-parts" className="h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="labor-parts">Labor & Parts</TabsTrigger>
            <TabsTrigger value="mechanic-notes">Mechanic Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="labor-parts" className="mt-4 space-y-2">
                {!readOnly && (
                  <div className="border rounded-xl bg-muted/40 px-3 py-2">
                    <div className="grid grid-cols-[1fr_70px_auto] gap-2">
                      <div className="relative">
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
                          className="h-8 text-xs"
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
                                            <div className="text-xs font-medium">{operation.code}</div>
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
                                            <div className="text-xs font-medium">
                                              {part.supplierPartNumber}
                                              {part.oemNumber ? ` · OEM ${part.oemNumber}` : ''}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">
                                              {part.brand} · {part.description}
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
                        className="h-8 text-xs text-right"
                        disabled={readOnly || !stagedLineItem}
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={confirmStagedItem}
                        disabled={readOnly || !stagedLineItem}
                      >
                        + Add
                      </Button>
                    </div>
                  </div>
                )}

                <div className="border rounded-xl overflow-hidden">
                  <div className="max-h-[420px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-[84px] text-xs">Type</TableHead>
                          <TableHead className="text-xs">Item No.</TableHead>
                          <TableHead className="text-xs">Description</TableHead>
                          <TableHead className="w-[54px] text-xs">Qty</TableHead>
                          <TableHead className="w-[96px] text-xs">Unit Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item) => (
                          <TableRow
                            key={item.id}
                            className={`transition-colors duration-500 ${
                              highlightedRowId === item.id
                                ? 'bg-blue-50/80 dark:bg-blue-500/20'
                                : ''
                            }`}
                          >
                            <TableCell>
                              <Badge variant={item.type === 'LABOR' ? 'secondary' : 'outline'}>
                                {item.type === 'LABOR' ? 'Labor' : 'Part'}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{item.itemNo}</TableCell>
                            <TableCell className="text-muted-foreground">{item.description}</TableCell>
                            <TableCell>
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
                                    className="h-7 w-16 text-right text-xs"
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
                            <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border bg-muted/40 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Package className="h-3.5 w-3.5" />
                      <span>Parts</span>
                    </div>
                    <div className="mt-1 text-sm font-medium">{formatCurrency(partsSubtotal)}</div>
                  </div>
                  <div className="rounded-xl border bg-muted/40 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      <span>Labor</span>
                    </div>
                    <div className="mt-1 text-sm font-medium">{formatCurrency(laborSubtotal)}</div>
                  </div>
                  <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-primary/80">
                      <CircleDollarSign className="h-3.5 w-3.5" />
                      <span>Task Total</span>
                    </div>
                    <div className="mt-1 text-sm font-semibold text-primary">{formatCurrency(taskTotal)}</div>
                  </div>
                </div>
          </TabsContent>

          <TabsContent value="mechanic-notes" className="mt-4 flex-1">
            <textarea
              className={`w-full min-h-[460px] rounded-xl border p-3 text-sm outline-none focus:ring-2 focus:ring-ring ${
                readOnly ? 'bg-muted/40' : ''
              }`}
              placeholder="Mechanic observations, measurements, and service notes..."
              defaultValue={task?.mechanicNotes ?? ''}
              key={`mechanic-notes-${task?.id ?? 'none'}`}
              readOnly={readOnly}
              onBlur={(e) => {
                if (!task) return
                if (readOnly) return
                const nextNotes = e.currentTarget.value
                if (nextNotes !== (task.mechanicNotes ?? '')) {
                  onTaskMechanicNotesChange(task.id, nextNotes)
                }
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </motion.div>
  )

  if (isDocked) {
    if (!open) return null
    return (
      <div className="h-[calc(100vh-7.5rem)] rounded-xl border bg-background shadow-sm overflow-hidden">
        {panelBody}
      </div>
    )
  }

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        overlayClassName="bg-transparent pointer-events-none"
        className="w-[94vw] sm:w-[42vw] sm:max-w-[760px] p-0 transform-gpu will-change-transform"
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null
          if (target?.closest('[data-workshop-task-row="true"]')) {
            event.preventDefault()
          }
        }}
      >
        {panelBody}
      </SheetContent>
    </Sheet>
  )
}
