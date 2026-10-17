import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Loader2, MapPin, Package } from 'lucide-react'
import { toast } from 'sonner'
import { useLocations } from '@/api/locations'
import { usePickWorkshopParts, useWorkshopOrder, workshopKeys } from '@/api/workshop'
import type { StorageLocation } from '@/api/locations'
import type { WorkshopOrder, WorkshopPickLineItemPayload } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  getRequiredPartLines,
  getTotalRequiredQuantity,
  isWorkshopOrderPickEligible,
} from '@/features/workshop/pick-utils'

interface WorkshopOrderPickDrawerProps {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const formatQuantity = (value: number) =>
  Number.isInteger(value) ? String(Math.trunc(value)) : String(value)

type WorkshopOrderPickDrawerBodyProps = WorkshopOrderPickDrawerProps & {
  areLocationsLoading: boolean
  isOrderLoading: boolean
  locations: StorageLocation[] | undefined
  order: WorkshopOrder | null | undefined
}

function WorkshopOrderPickDrawerBody({
  orderId,
  open,
  onOpenChange,
  areLocationsLoading,
  isOrderLoading,
  locations,
  order,
}: WorkshopOrderPickDrawerBodyProps) {
  const { t } = useTranslation('workshop')
  const queryClient = useQueryClient()
  const pickPartsMutation = usePickWorkshopParts()
  const toteTriggerRef = useRef<HTMLButtonElement | null>(null)

  const [isTotePopoverOpen, setIsTotePopoverOpen] = useState(false)
  const requiredPartLines = useMemo(() => getRequiredPartLines(order), [order])
  const requiredLineCount = requiredPartLines.length
  const totalRequiredQuantity = getTotalRequiredQuantity(requiredPartLines)
  const isPickEligible = isWorkshopOrderPickEligible(order)

  const defaultQuantitiesByLineId = useMemo(() => {
    const defaults: Record<string, string> = {}
    requiredPartLines.forEach((line) => {
      defaults[line.workshopTaskLineItemId] = formatQuantity(line.requiredQuantity)
    })
    return defaults
  }, [requiredPartLines])

  const [selectedStagingLocationId, setSelectedStagingLocationId] = useState<string | null>(
    () => order?.stagingLocationId ?? order?.staging_location_id ?? null,
  )
  const [quantitiesByLineId, setQuantitiesByLineId] = useState<Record<string, string>>(
    () => defaultQuantitiesByLineId,
  )
  const [formError, setFormError] = useState<string | null>(null)

  const stagingTotes = useMemo(
    () => (locations ?? []).filter((location) => location.type === 'staging_tote'),
    [locations],
  )

  const selectedTote = stagingTotes.find((location) => location.id === selectedStagingLocationId)

  const hasPositiveQuantity = useMemo(
    () =>
      requiredPartLines.some((line) => {
        const value = Number(quantitiesByLineId[line.workshopTaskLineItemId])
        return Number.isFinite(value) && value > 0
      }),
    [requiredPartLines, quantitiesByLineId],
  )

  useEffect(() => {
    if (!open) return

    const focusTimer = window.setTimeout(() => {
      toteTriggerRef.current?.focus()
    }, 20)

    return () => window.clearTimeout(focusTimer)
  }, [open])

  const handlePickAll = () => {
    setQuantitiesByLineId(defaultQuantitiesByLineId)
    setFormError(null)
  }

  const normalizeItems = (): { items: WorkshopPickLineItemPayload[]; error: string | null } => {
    const normalizedItemsByLineId = new Map<string, WorkshopPickLineItemPayload>()

    for (const line of requiredPartLines) {
      const rawValue = quantitiesByLineId[line.workshopTaskLineItemId]?.trim() ?? ''
      if (!rawValue) continue

      const parsedQuantity = Number(rawValue)
      if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0 || !Number.isInteger(parsedQuantity)) {
        return {
          items: [],
          error: t('pick.drawer.qtyInvalid', { itemNo: line.itemNo }),
        }
      }

      if (parsedQuantity === 0) continue

      const existing = normalizedItemsByLineId.get(line.workshopTaskLineItemId)
      if (existing) {
        existing.quantity += parsedQuantity
        continue
      }

      normalizedItemsByLineId.set(line.workshopTaskLineItemId, {
        workshopTaskLineItemId: line.workshopTaskLineItemId,
        quantity: parsedQuantity,
      })
    }

    return {
      items: Array.from(normalizedItemsByLineId.values()),
      error: null,
    }
  }

  const handleConfirmPick = async () => {
    if (!orderId || !order || pickPartsMutation.isPending) {
      return
    }

    setFormError(null)

    if (!isPickEligible) {
      const message = t('pick.drawer.notEligibleAnymore')
      setFormError(message)
      toast.error(message)
      return
    }

    if (!selectedStagingLocationId) {
      const message = t('pick.drawer.selectToteFirst')
      setFormError(message)
      return
    }

    const { items, error } = normalizeItems()
    if (error) {
      setFormError(error)
      return
    }

    if (items.length === 0) {
      const message = t('pick.drawer.qtyRequired')
      setFormError(message)
      return
    }

    try {
      await pickPartsMutation.mutateAsync({
        orderId,
        payload: {
          destinationLocationId: selectedStagingLocationId,
          items,
        },
      })
      toast.success(t('pick.drawer.success'))
      onOpenChange(false)
    } catch (error) {
      const mutationError = error as { status?: number; message?: string }
      if (mutationError.status === 409) {
        toast.error(t('pick.drawer.conflict'))
        queryClient.invalidateQueries({ queryKey: workshopKeys.detail(orderId) })
        queryClient.invalidateQueries({ queryKey: workshopKeys.pickList() })
        return
      }

      if (mutationError.status === 404) {
        toast.error(mutationError.message || t('pick.drawer.notFound'))
        onOpenChange(false)
        return
      }

      toast.error(mutationError.message || t('pick.drawer.failed'))
    }
  }

  const isConfirmDisabled =
    !isPickEligible ||
    !selectedStagingLocationId ||
    !hasPositiveQuantity ||
    pickPartsMutation.isPending ||
    isOrderLoading

  return (
    <form
      className='flex h-full flex-col'
      onSubmit={(event) => {
        event.preventDefault()
        void handleConfirmPick()
      }}
    >
      <SheetHeader className='px-6 py-4 border-b pr-14' data-pick-drawer-header='true'>
        <div className='flex items-start justify-between gap-4'>
          <div className='min-w-0'>
            <SheetTitle className='text-lg font-semibold flex items-center gap-2'>
              <Package className='h-4 w-4' />
              {t('pick.drawer.title')}
            </SheetTitle>
            <SheetDescription className='text-sm text-muted-foreground'>
              {t('pick.drawer.description')}
            </SheetDescription>
            <div className='mt-2 flex flex-wrap items-center gap-2'>
              {order ? (
                <Badge variant='outline'>
                  {order.order_number}
                </Badge>
              ) : null}
              {order ? (
                <Badge variant='outline'>
                  {order.status}
                </Badge>
              ) : null}
              <Badge variant='secondary'>
                {t('pick.drawer.linesBadge', { count: requiredLineCount })}
              </Badge>
            </div>
          </div>

          <div className='shrink-0 flex items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={pickPartsMutation.isPending}
            >
              {t('pick.drawer.cancel')}
            </Button>
            <Button type='submit' disabled={isConfirmDisabled}>
              {pickPartsMutation.isPending ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              {t('pick.drawer.confirm')}
            </Button>
          </div>
        </div>
      </SheetHeader>

      <div className='px-6 py-4 space-y-4 flex-1 min-h-0'>
        <div className='space-y-2'>
          <div className='text-sm font-medium text-foreground'>
            {t('pick.drawer.destinationTote')}
          </div>
          {areLocationsLoading && stagingTotes.length === 0 ? (
            <div className='space-y-2'>
              <div className='h-9 w-full rounded-md bg-slate-100 animate-pulse' />
              <div className='h-4 w-64 rounded bg-slate-100 animate-pulse' />
            </div>
          ) : (
            <Popover open={isTotePopoverOpen} onOpenChange={setIsTotePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  ref={toteTriggerRef}
                  type='button'
                  variant='outline'
                  role='combobox'
                  aria-expanded={isTotePopoverOpen}
                  className='w-full justify-between'
                  disabled={pickPartsMutation.isPending}
                >
                  <span className='truncate'>
                    {selectedTote
                      ? `${selectedTote.code} - ${selectedTote.name}`
                      : t('pick.drawer.selectTote')}
                  </span>
                  <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-0' align='start'>
                <Command>
                  <CommandInput
                    placeholder={t('pick.drawer.searchTote')}
                    aria-label={t('pick.drawer.searchToteAria')}
                  />
                  <CommandList>
                    <CommandEmpty>{t('pick.drawer.noTote')}</CommandEmpty>
                    <CommandGroup>
                      {stagingTotes.map((location) => (
                        <CommandItem
                          key={location.id}
                          value={`${location.code} ${location.name}`}
                          onSelect={() => {
                            setSelectedStagingLocationId(location.id)
                            setIsTotePopoverOpen(false)
                            setFormError(null)
                          }}
                        >
                          <Check
                            className={cn(
                              'h-4 w-4',
                              selectedStagingLocationId === location.id ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          <span className='truncate'>{location.code} - {location.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
          <p className='text-xs text-muted-foreground'>
            {selectedTote
              ? t('pick.drawer.selectedTote', { code: selectedTote.code })
              : t('pick.drawer.chooseTote')}
          </p>
        </div>

        <Separator />

        <div className='flex items-center justify-between gap-3'>
          <div className='text-sm font-medium'>{t('pick.drawer.requiredParts')}</div>
          <div className='flex items-center gap-2'>
            <Badge variant='outline'>
              {t('pick.drawer.totalQty', { qty: formatQuantity(totalRequiredQuantity) })}
            </Badge>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={handlePickAll}
              disabled={requiredPartLines.length === 0 || pickPartsMutation.isPending}
            >
              {t('pick.drawer.pickAll')}
            </Button>
          </div>
        </div>

        <ScrollArea className='flex-1 pr-2'>
          {isOrderLoading ? (
            <div className='space-y-2'>
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className='h-11 rounded-md bg-slate-100 animate-pulse' />
              ))}
            </div>
          ) : requiredPartLines.length === 0 ? (
            <div className='rounded-md border border-dashed p-6 text-sm text-muted-foreground'>
              {t('pick.drawer.noParts')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('pick.drawer.colPart')}</TableHead>
                  <TableHead>{t('pick.drawer.colTask')}</TableHead>
                  <TableHead className='text-right'>{t('pick.drawer.colRequired')}</TableHead>
                  <TableHead className='w-[150px] text-right'>{t('pick.drawer.colPickQty')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requiredPartLines.map((line) => (
                  <TableRow key={line.workshopTaskLineItemId}>
                    <TableCell>
                      <div className='font-medium'>{line.itemNo}</div>
                      <div className='text-xs text-muted-foreground'>{line.description}</div>
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>{line.taskTitle}</TableCell>
                    <TableCell className='text-right font-medium'>{formatQuantity(line.requiredQuantity)}</TableCell>
                    <TableCell>
                      <Input
                        type='number'
                        min='0'
                        step='1'
                        inputMode='numeric'
                        value={quantitiesByLineId[line.workshopTaskLineItemId] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          setQuantitiesByLineId((previous) => ({
                            ...previous,
                            [line.workshopTaskLineItemId]: value,
                          }))
                          setFormError(null)
                        }}
                        className='h-8 text-right'
                        aria-label={t('pick.drawer.qtyAria', {
                          description: line.description,
                          itemNo: line.itemNo,
                        })}
                        disabled={!isPickEligible || pickPartsMutation.isPending}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>

        {!isPickEligible ? (
          <div className='rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2'>
            <MapPin className='h-4 w-4 mt-0.5 shrink-0' />
            {t('pick.drawer.notEligible')}
          </div>
        ) : null}

        {formError ? (
          <div className='rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive'>
            {formError}
          </div>
        ) : null}
      </div>
    </form>
  )
}

export function WorkshopOrderPickDrawer({
  orderId,
  open,
  onOpenChange,
}: WorkshopOrderPickDrawerProps) {
  const { data: order, isLoading: isOrderLoading } = useWorkshopOrder(orderId ?? '')
  const { data: locations, isLoading: areLocationsLoading } = useLocations({ enabled: open })
  const drawerStateKey = open
    ? `${orderId ?? 'no-order'}:${order?.id ?? 'loading'}`
    : `closed:${orderId ?? 'no-order'}`

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='w-full sm:max-w-3xl p-0 flex h-full flex-col'>
        <WorkshopOrderPickDrawerBody
          key={drawerStateKey}
          orderId={orderId}
          open={open}
          onOpenChange={onOpenChange}
          order={order}
          locations={locations}
          isOrderLoading={isOrderLoading}
          areLocationsLoading={areLocationsLoading}
        />
      </SheetContent>
    </Sheet>
  )
}
