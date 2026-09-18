import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthSession } from '@/api/auth-session'
import { useInventory } from '@/api/inventory'
import { useMySites, useSiteDirectory } from '@/api/sites'
import { useCreateStockTransfer } from '@/api/stock-transfers'
import { useLocations } from '@/api/locations'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getErrorMessage } from '@/lib/error-utils'
import {
  buildMemberSiteIdSet,
  canSuggestSourceBin,
} from './stock-transfer-permissions'

type DraftLine = {
  catalogItemId: string
  sku: string
  name: string
  requestedQty: string
  sourceLocationId?: string
}

type StockTransferCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function StockTransferCreateDialog({
  open,
  onOpenChange,
}: StockTransferCreateDialogProps) {
  const navigate = useNavigate()
  const sessionQuery = useAuthSession()
  const { data: mySites = [] } = useMySites(open)
  const { data: siteDirectory = [] } = useSiteDirectory(open)
  const createTransfer = useCreateStockTransfer()

  const memberSiteIds = useMemo(
    () => buildMemberSiteIdSet(mySites.map((site) => site.id)),
    [mySites],
  )

  const defaultToSiteId =
    sessionQuery.data?.activeSiteId ?? mySites[0]?.id ?? ''

  const [fromSiteId, setFromSiteId] = useState('')
  const [toSiteId, setToSiteId] = useState(defaultToSiteId)
  const [searchQuery, setSearchQuery] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])

  const showSourceBin = canSuggestSourceBin(fromSiteId, memberSiteIds)
  const { data: locations = [] } = useLocations({
    enabled: open && showSourceBin,
  })

  const { data: inventoryResponse, isFetching: isSearchingInventory } = useInventory(
    { search: searchQuery, pageSize: 8 },
    { enabled: open && searchQuery.trim().length > 0 },
  )

  const inventoryResults = inventoryResponse?.data ?? []

  useEffect(() => {
    if (!open) return
    setToSiteId(defaultToSiteId)
  }, [open, defaultToSiteId])

  const availableFromSites = siteDirectory.filter((site) => site.id !== toSiteId)
  const availableToSites = siteDirectory.filter((site) => site.id !== fromSiteId)

  const resetForm = () => {
    setFromSiteId('')
    setToSiteId(defaultToSiteId)
    setSearchQuery('')
    setLines([])
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) resetForm()
    onOpenChange(nextOpen)
  }

  const addLine = (item: { id: string; sku: string; name: string }) => {
    if (lines.some((line) => line.catalogItemId === item.id)) {
      toast.error('Part already added to this transfer request')
      return
    }

    setLines((current) => [
      ...current,
      {
        catalogItemId: item.id,
        sku: item.sku,
        name: item.name,
        requestedQty: '1',
      },
    ])
    setSearchQuery('')
  }

  const handleSubmit = async () => {
    if (!fromSiteId || !toSiteId) {
      toast.error('Select both from and to sites')
      return
    }

    if (fromSiteId === toSiteId) {
      toast.error('From and to sites must differ')
      return
    }

    if (lines.length === 0) {
      toast.error('Add at least one line')
      return
    }

    const payloadLines = lines.map((line) => {
      const requestedQty = Number(line.requestedQty)
      if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
        throw new Error(`Invalid quantity for ${line.sku}`)
      }

      return {
        catalogItemId: line.catalogItemId,
        requestedQty,
        ...(showSourceBin && line.sourceLocationId
          ? { sourceLocationId: line.sourceLocationId }
          : {}),
      }
    })

    try {
      const transfer = await createTransfer.mutateAsync({
        fromSiteId,
        toSiteId,
        lines: payloadLines,
      })
      toast.success('Transfer request created')
      handleClose(false)
      navigate(`/stock-transfers/${transfer.id}`)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create transfer request'))
    }
  }

  const sourceBins = locations.filter((location) => location.type === 'bin')

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Request Stock Transfer</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="transfer-from-site">From site</Label>
            <Select value={fromSiteId} onValueChange={setFromSiteId}>
              <SelectTrigger id="transfer-from-site">
                <SelectValue placeholder="Select source site" />
              </SelectTrigger>
              <SelectContent>
                {availableFromSites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name} ({site.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-to-site">To site</Label>
            <Select value={toSiteId} onValueChange={setToSiteId}>
              <SelectTrigger id="transfer-to-site">
                <SelectValue placeholder="Select destination site" />
              </SelectTrigger>
              <SelectContent>
                {availableToSites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name} ({site.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="transfer-part-search">Add parts</Label>
          <Input
            id="transfer-part-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by SKU or name…"
          />
          {searchQuery.trim().length > 0 ? (
            <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200">
              {isSearchingInventory ? (
                <p className="px-3 py-2 text-sm text-slate-500">Searching…</p>
              ) : inventoryResults.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500">No matching parts.</p>
              ) : (
                inventoryResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => addLine(item)}
                  >
                    <span className="font-medium">{item.sku}</span>
                    <span className="truncate text-slate-500">{item.name}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        {lines.length > 0 ? (
          <div className="space-y-3 rounded-md border border-slate-200 p-3">
            {lines.map((line) => (
              <div key={line.catalogItemId} className="grid gap-2 sm:grid-cols-[1fr_120px]">
                <div>
                  <p className="text-sm font-medium">{line.sku}</p>
                  <p className="text-xs text-slate-500">{line.name}</p>
                </div>
                <div className="space-y-2">
                  <Input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={line.requestedQty}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((entry) =>
                          entry.catalogItemId === line.catalogItemId
                            ? { ...entry, requestedQty: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    aria-label={`Requested quantity for ${line.sku}`}
                  />
                  {showSourceBin ? (
                    <Select
                      value={line.sourceLocationId ?? ''}
                      onValueChange={(value) =>
                        setLines((current) =>
                          current.map((entry) =>
                            entry.catalogItemId === line.catalogItemId
                              ? { ...entry, sourceLocationId: value }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger aria-label={`Source bin for ${line.sku}`}>
                        <SelectValue placeholder="Source bin (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {sourceBins.map((location) => (
                          <SelectItem key={location.id} value={location.id}>
                            {location.code} — {location.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={createTransfer.isPending}>
            {createTransfer.isPending ? 'Submitting…' : 'Submit request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
