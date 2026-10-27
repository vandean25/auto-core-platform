import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { ensureNamespaceLoaded } from '@/lib/i18n'
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
  const { t } = useTranslation(['inventory', 'common'])
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

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
      toast.error(t('inventory:stockTransfers.create.partAlreadyAdded'))
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
      toast.error(t('inventory:stockTransfers.create.selectBothSites'))
      return
    }

    if (fromSiteId === toSiteId) {
      toast.error(t('inventory:stockTransfers.create.sitesMustDiffer'))
      return
    }

    if (lines.length === 0) {
      toast.error(t('inventory:stockTransfers.create.addAtLeastOneLine'))
      return
    }

    try {
      const payloadLines = lines.map((line) => {
        const requestedQty = Number(line.requestedQty)
        if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
          throw new Error(t('inventory:stockTransfers.create.invalidQuantityForSku', { sku: line.sku }))
        }

        return {
          catalogItemId: line.catalogItemId,
          requestedQty,
          ...(showSourceBin && line.sourceLocationId
            ? { sourceLocationId: line.sourceLocationId }
            : {}),
        }
      })

      const transfer = await createTransfer.mutateAsync({
        fromSiteId,
        toSiteId,
        lines: payloadLines,
      })
      toast.success(t('inventory:stockTransfers.create.success'))
      handleClose(false)
      navigate(`/stock-transfers/${transfer.id}`)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('inventory:stockTransfers.create.failed')))
    }
  }

  const sourceBins = locations.filter((location) => location.type === 'bin')

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent fullScreenOnPhone className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('inventory:stockTransfers.create.title')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="transfer-from-site">{t('inventory:stockTransfers.create.fromSite')}</Label>
            <Select value={fromSiteId} onValueChange={setFromSiteId}>
              <SelectTrigger id="transfer-from-site">
                <SelectValue placeholder={t('inventory:stockTransfers.create.selectSourceSite')} />
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
            <Label htmlFor="transfer-to-site">{t('inventory:stockTransfers.create.toSite')}</Label>
            <Select value={toSiteId} onValueChange={setToSiteId}>
              <SelectTrigger id="transfer-to-site">
                <SelectValue placeholder={t('inventory:stockTransfers.create.selectDestSite')} />
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
          <Label htmlFor="transfer-part-search">{t('inventory:stockTransfers.create.addParts')}</Label>
          <Input
            id="transfer-part-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('inventory:stockTransfers.create.searchPartsPlaceholder')}
          />
          {searchQuery.trim().length > 0 ? (
            <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200">
              {isSearchingInventory ? (
                <p className="px-3 py-2 text-sm text-slate-500">{t('inventory:shared.searching')}</p>
              ) : inventoryResults.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500">
                  {t('inventory:stockTransfers.create.noMatchingParts')}
                </p>
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
                    aria-label={t('inventory:stockTransfers.create.requestedQtyAria', { sku: line.sku })}
                  />
                  {showSourceBin ? (
                    <Select
                      value={line.sourceLocationId ?? undefined}
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
                      <SelectTrigger
                        aria-label={t('inventory:stockTransfers.create.sourceBinAria', { sku: line.sku })}
                      >
                        <SelectValue placeholder={t('inventory:stockTransfers.create.sourceBinOptional')} />
                      </SelectTrigger>
                      <SelectContent>
                        {sourceBins.map((location) => (
                          <SelectItem key={location.id} value={location.id}>
                            {t('inventory:shared.locationCodeName', {
                              code: location.code,
                              name: location.name,
                            })}
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
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={createTransfer.isPending}>
            {createTransfer.isPending
              ? t('inventory:actions.submitting')
              : t('inventory:actions.submitRequest')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
