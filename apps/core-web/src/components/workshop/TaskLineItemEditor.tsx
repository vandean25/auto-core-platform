import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { CircleDollarSign, Clock3, Package, Trash2 } from 'lucide-react'
import { useLaborOperation } from '@/api/labor'
import { useCatalogSearch } from '@/api/workshop'
import type {
  CatalogPartSearchItem,
  LaborOperationSearchItem,
  WorkshopLineItemType,
} from '@/api/types'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface TaskLineItem {
  id: string
  type: WorkshopLineItemType
  itemNo: string
  description: string
  qty: number
  unitPrice: number
  laborOperationId?: string | null
  standardAw?: number | null
  actualHours?: number | null
  internalCostRate?: number | null
}

export interface TaskLineItemEditorProps {
  workshopOrderId: string
  taskId: string
  lineItems: TaskLineItem[]
  readOnly: boolean
  onLineItemsChange: (items: TaskLineItem[]) => void
}

interface StagedLineItemDraft {
  type: WorkshopLineItemType
  itemNo: string
  description: string
  unitPrice: number
  label: string
  laborOperationId?: string
  standardAw?: number | null
}

const STABLE_EMPTY_LABOR: LaborOperationSearchItem[] = []
const STABLE_EMPTY_PARTS: CatalogPartSearchItem[] = []
const SEARCH_DEBOUNCE_MS = 300
const MERGE_FLASH_DURATION_MS = 500
const QUANTITY_POP_DURATION_MS = 240

function formatHours(value: number | null | undefined) {
  if (value == null) return '—'
  return value.toFixed(2)
}

function calculateEfficiencyRatio(
  standardAw: number | null | undefined,
  actualHours: number | null | undefined,
) {
  if (standardAw == null || actualHours == null || actualHours <= 0) return null
  return standardAw / actualHours
}

function getEfficiencyBadgeClass(ratio: number) {
  if (ratio >= 1) {
    return 'border-emerald-200 bg-emerald-100 text-emerald-700'
  }
  return 'border-amber-200 bg-amber-100 text-amber-700'
}

export function TaskLineItemEditor({
  workshopOrderId,
  taskId,
  lineItems,
  readOnly,
  onLineItemsChange,
}: TaskLineItemEditorProps) {
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

  const queryForSearch = stagedLineItem ? '' : debouncedSearchQuery
  const { data: catalogSearch, isFetching: isSearchingCatalog } = useCatalogSearch(
    queryForSearch,
    workshopOrderId,
    true,
  )
  const stagedLaborOperationId =
    stagedLineItem?.type === 'LABOR' ? stagedLineItem.laborOperationId ?? '' : ''
  const {
    data: stagedLaborOperation,
    isFetching: isFetchingStagedLaborOperation,
  } = useLaborOperation(stagedLaborOperationId)
  const stagedLaborInternalCostRate =
    typeof stagedLaborOperation?.internalCost === 'number'
      ? stagedLaborOperation.internalCost
      : null
  const laborSuggestions = catalogSearch?.labor ?? STABLE_EMPTY_LABOR
  const partSuggestions = catalogSearch?.parts ?? STABLE_EMPTY_PARTS

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim())
    }, SEARCH_DEBOUNCE_MS)
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
    }, MERGE_FLASH_DURATION_MS)
    qtyPopTimeoutRef.current = window.setTimeout(() => {
      setPoppedQtyRowId(null)
    }, QUANTITY_POP_DURATION_MS)
  }

  function addOrMergeLineItem(next: TaskLineItem) {
    if (readOnly) return
    const existing = lineItems.find(
      (lineItem) =>
        lineItem.type === next.type &&
        lineItem.itemNo.toLowerCase() === next.itemNo.toLowerCase(),
    )

    if (!existing) {
      onLineItemsChange([...lineItems, next])
    } else {
      onLineItemsChange(
        lineItems.map((lineItem) =>
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
      laborOperationId: operation.id,
      standardAw: operation.standardAw,
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
    if (readOnly || !stagedLineItem) return
    const qty = Number(newQty)
    const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1
    const stagedLaborMetadata =
      stagedLineItem.type === 'LABOR'
        ? {
            laborOperationId: stagedLineItem.laborOperationId,
            standardAw: stagedLineItem.standardAw ?? safeQty,
            actualHours: null,
            internalCostRate: stagedLaborInternalCostRate,
          }
        : {}

    addOrMergeLineItem({
      id: `li-${taskId}-${lineItems.length + 1}`,
      type: stagedLineItem.type,
      itemNo: stagedLineItem.itemNo,
      description: stagedLineItem.description,
      qty: safeQty,
      unitPrice: stagedLineItem.unitPrice,
      ...stagedLaborMetadata,
    })
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

  function updateLineItemQuantity(lineItemId: string, nextQty: number) {
    if (readOnly || !Number.isFinite(nextQty) || nextQty <= 0) return
    const target = lineItems.find((lineItem) => lineItem.id === lineItemId)
    if (!target || target.qty === nextQty) return

    onLineItemsChange(
      lineItems.map((lineItem) =>
        lineItem.id === lineItemId ? { ...lineItem, qty: nextQty } : lineItem,
      ),
    )
  }

  function updateLineItemUnitPrice(lineItemId: string, nextUnitPrice: number) {
    if (readOnly || !Number.isFinite(nextUnitPrice) || nextUnitPrice < 0) return
    const target = lineItems.find((lineItem) => lineItem.id === lineItemId)
    if (!target || target.unitPrice === nextUnitPrice) return

    onLineItemsChange(
      lineItems.map((lineItem) =>
        lineItem.id === lineItemId
          ? { ...lineItem, unitPrice: nextUnitPrice }
          : lineItem,
      ),
    )
  }

  function updateLaborActualHours(lineItemId: string, nextActualHours: number | null) {
    if (readOnly) return
    const target = lineItems.find((lineItem) => lineItem.id === lineItemId)
    if (!target || target.type !== 'LABOR') return
    if ((target.actualHours ?? null) === nextActualHours) return

    onLineItemsChange(
      lineItems.map((lineItem) =>
        lineItem.id === lineItemId
          ? { ...lineItem, actualHours: nextActualHours }
          : lineItem,
      ),
    )
  }

  function removeLineItem(lineItemId: string) {
    if (readOnly) return
    onLineItemsChange(lineItems.filter((lineItem) => lineItem.id !== lineItemId))
  }

  const normalizedSearchQuery = searchQuery.trim()
  const showSuggestions = !stagedLineItem && normalizedSearchQuery.length >= 2
  const hasResults = laborSuggestions.length > 0 || partSuggestions.length > 0
  const isSuggestionStateReady =
    normalizedSearchQuery.length >= 2 &&
    debouncedSearchQuery === normalizedSearchQuery &&
    !isSearchingCatalog &&
    hasResults
  const isStagedLaborMetadataLoading =
    stagedLineItem?.type === 'LABOR' &&
    !!stagedLineItem.laborOperationId &&
    isFetchingStagedLaborOperation
  const partsSubtotal = lineItems
    .filter((item) => item.type === 'PART')
    .reduce((acc, item) => acc + item.qty * item.unitPrice, 0)
  const laborSubtotal = lineItems
    .filter((item) => item.type === 'LABOR')
    .reduce((acc, item) => acc + item.qty * item.unitPrice, 0)
  const taskTotal = partsSubtotal + laborSubtotal

  return (
    <div className='space-y-4' data-workshop-task-editor={taskId}>
      {!readOnly && (
        <div className='border rounded-xl bg-muted/40 px-3 py-2'>
          <div className='grid grid-cols-[1fr_70px_auto] gap-2'>
            <div className='relative'>
              <Input
                ref={itemInputRef}
                value={searchQuery}
                onChange={(event) => {
                  if (stagedLineItem) {
                    setStagedLineItem(null)
                  }
                  setSearchQuery(event.target.value)
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder='Search labor or part number...'
                className='h-8 text-xs'
              />
              {showSuggestions && (
                <div className='absolute left-0 right-0 top-full z-20 mt-1 rounded-md border bg-popover shadow-md'>
                  <Command shouldFilter={false}>
                    <CommandList className='max-h-64'>
                      {!isSearchingCatalog && !hasResults && (
                        <CommandEmpty>No compatible catalog items found.</CommandEmpty>
                      )}
                      {laborSuggestions.length > 0 && (
                        <CommandGroup heading='Labor'>
                          {laborSuggestions.map((operation) => (
                            <CommandItem
                              key={operation.id}
                              value={`${operation.code} ${operation.description}`}
                              onSelect={() => stageLaborOperation(operation)}
                            >
                              <div className='flex w-full items-center justify-between gap-2'>
                                <div className='min-w-0'>
                                  <div className='text-xs font-medium'>{operation.code}</div>
                                  <div className='truncate text-xs text-muted-foreground'>
                                    {operation.description}
                                  </div>
                                </div>
                                <div className='shrink-0 text-xs text-muted-foreground'>
                                  {operation.standardAw} AW
                                </div>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                      {partSuggestions.length > 0 && (
                        <CommandGroup heading='Parts'>
                          {partSuggestions.map((part) => (
                            <CommandItem
                              key={part.id}
                              value={`${part.supplierPartNumber} ${part.description}`}
                              onSelect={() => stagePart(part)}
                            >
                              <div className='flex w-full items-center justify-between gap-2'>
                                <div className='min-w-0'>
                                  <div className='text-xs font-medium'>
                                    {part.supplierPartNumber}
                                    {part.oemNumber ? ` · OEM ${part.oemNumber}` : ''}
                                  </div>
                                  <div className='truncate text-xs text-muted-foreground'>
                                    {part.brand} · {part.description}
                                  </div>
                                </div>
                                <div className='shrink-0 text-right text-xs text-muted-foreground'>
                                  <div>{formatCurrency(part.retailPrice ?? 0)}</div>
                                  <div>Stock: {part.quantityOnHand}</div>
                                </div>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                      {isSearchingCatalog && (
                        <div className='px-2 py-2 text-xs text-muted-foreground'>Searching...</div>
                      )}
                    </CommandList>
                  </Command>
                </div>
              )}
            </div>
            <Input
              ref={qtyInputRef}
              value={newQty}
              onChange={(event) => setNewQty(event.target.value)}
              onKeyDown={handleQtyKeyDown}
              placeholder='Qty'
              className='h-8 text-xs text-right'
              disabled={!stagedLineItem}
            />
            <Button
              type='button'
              size='sm'
              className='h-8 px-3 text-xs'
              onClick={confirmStagedItem}
              disabled={!stagedLineItem || isStagedLaborMetadataLoading}
            >
              + Add
            </Button>
          </div>
          {isStagedLaborMetadataLoading && (
            <p className='mt-1 text-[11px] text-muted-foreground'>Loading labor metadata...</p>
          )}
          {stagedLineItem && (
            <p className='mt-1 truncate text-[11px] text-muted-foreground'>
              {stagedLineItem.label}
            </p>
          )}
        </div>
      )}

      <div className='border rounded-xl overflow-hidden'>
        <div className='max-h-[420px] overflow-auto'>
          <Table>
            <TableHeader className='sticky top-0 bg-background z-10'>
              <TableRow className='hover:bg-transparent'>
                <TableHead className='w-[84px] text-xs'>Type</TableHead>
                <TableHead className='text-xs'>Item No.</TableHead>
                <TableHead className='text-xs'>Description</TableHead>
                <TableHead className='w-[80px] text-xs'>Qty</TableHead>
                <TableHead className='w-[112px] text-xs'>Unit Price</TableHead>
                {!readOnly && <TableHead className='w-[48px] text-xs' />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={readOnly ? 5 : 6}
                    className='py-6 text-center text-sm text-muted-foreground'
                  >
                    No parts or labor lines yet.
                  </TableCell>
                </TableRow>
              )}
              {lineItems.map((item) => {
                const efficiencyRatio = calculateEfficiencyRatio(
                  item.standardAw,
                  item.actualHours,
                )

                return (
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
                    <TableCell className='font-medium'>{item.itemNo}</TableCell>
                    <TableCell>
                      <div className='space-y-1'>
                        <div className='text-muted-foreground'>{item.description}</div>
                        {item.type === 'LABOR' && (
                          <div className='flex flex-wrap items-center gap-2'>
                            <Badge variant='outline' className='text-[10px]'>
                              Standard AW {formatHours(item.standardAw)}
                            </Badge>
                            {readOnly ? (
                              <Badge variant='outline' className='text-[10px]'>
                                Actual Hours {formatHours(item.actualHours)}
                              </Badge>
                            ) : (
                              <div className='flex items-center gap-1'>
                                <span className='text-[10px] text-muted-foreground'>
                                  Actual Hours
                                </span>
                                <Input
                                  key={`${item.id}-${item.actualHours ?? 'none'}`}
                                  aria-label='Actual Hours'
                                  defaultValue={
                                    item.actualHours != null ? String(item.actualHours) : ''
                                  }
                                  inputMode='decimal'
                                  className='h-7 w-20 text-right text-xs'
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.currentTarget.blur()
                                    }
                                  }}
                                  onBlur={(event) => {
                                    const rawValue = event.currentTarget.value.trim()
                                    if (rawValue === '') {
                                      updateLaborActualHours(item.id, null)
                                      return
                                    }

                                    const parsedHours = Number(rawValue)
                                    if (!Number.isFinite(parsedHours) || parsedHours < 0) {
                                      event.currentTarget.value =
                                        item.actualHours != null ? String(item.actualHours) : ''
                                      return
                                    }

                                    event.currentTarget.value = String(parsedHours)
                                    updateLaborActualHours(item.id, parsedHours)
                                  }}
                                />
                              </div>
                            )}
                            {efficiencyRatio != null && (
                              <Badge
                                variant='outline'
                                className={`text-[10px] ${getEfficiencyBadgeClass(efficiencyRatio)}`}
                              >
                                Efficiency {efficiencyRatio.toFixed(2)}x
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {readOnly ? (
                        item.qty
                      ) : (
                        <motion.div
                          animate={
                            poppedQtyRowId === item.id
                              ? { scale: [1, 1.2, 1] }
                              : { scale: 1 }
                          }
                          transition={{ duration: 0.24, ease: 'easeOut' }}
                          className='origin-center'
                        >
                          <Input
                            key={`${item.id}-${item.qty}`}
                            aria-label={`Quantity ${item.itemNo}`}
                            defaultValue={String(item.qty)}
                            inputMode='decimal'
                            className='h-7 w-16 text-right text-xs'
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
                              updateLineItemQuantity(item.id, parsedQty)
                            }}
                          />
                        </motion.div>
                      )}
                    </TableCell>
                    <TableCell>
                      {readOnly ? (
                        formatCurrency(item.unitPrice)
                      ) : (
                        <Input
                          key={`${item.id}-${item.unitPrice}`}
                          aria-label={`Unit Price ${item.itemNo}`}
                          defaultValue={String(item.unitPrice)}
                          inputMode='decimal'
                          className='h-7 w-24 text-right text-xs'
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            }
                          }}
                          onBlur={(event) => {
                            const parsedPrice = Number(event.currentTarget.value)
                            if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
                              event.currentTarget.value = String(item.unitPrice)
                              return
                            }
                            event.currentTarget.value = String(parsedPrice)
                            updateLineItemUnitPrice(item.id, parsedPrice)
                          }}
                        />
                      )}
                    </TableCell>
                    {!readOnly && (
                      <TableCell>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-7 w-7 text-destructive hover:text-destructive'
                          aria-label={`Delete line ${item.itemNo}`}
                          onClick={() => removeLineItem(item.id)}
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className='grid grid-cols-3 gap-2'>
        <div className='rounded-xl border bg-muted/40 px-3 py-2'>
          <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
            <Package className='h-3.5 w-3.5' />
            <span>Parts</span>
          </div>
          <div className='mt-1 text-sm font-medium'>{formatCurrency(partsSubtotal)}</div>
        </div>
        <div className='rounded-xl border bg-muted/40 px-3 py-2'>
          <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
            <Clock3 className='h-3.5 w-3.5' />
            <span>Labor</span>
          </div>
          <div className='mt-1 text-sm font-medium'>{formatCurrency(laborSubtotal)}</div>
        </div>
        <div className='rounded-xl border border-primary/20 bg-primary/10 px-3 py-2'>
          <div className='flex items-center gap-1.5 text-[11px] text-primary/80'>
            <CircleDollarSign className='h-3.5 w-3.5' />
            <span>Task Total</span>
          </div>
          <div className='mt-1 text-sm font-semibold text-primary'>{formatCurrency(taskTotal)}</div>
        </div>
      </div>
    </div>
  )
}
