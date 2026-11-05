import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthSession } from '@/api/auth-session'
import { useInventory } from '@/api/inventory'
import { useLocations } from '@/api/locations'
import { useMySites, useSiteDirectory } from '@/api/sites'
import { buildMemberSiteIdSet, canSuggestSourceBin, resolveDefaultToSiteId } from './stock-transfer-permissions'
import type { DraftLine } from './stock-transfer-create-parts'

/** Sites, part search and draft lines of the new stock transfer dialog. */
export function useStockTransferCreateForm(open: boolean) {
  const { t } = useTranslation(['inventory', 'common'])
  const sessionQuery = useAuthSession()
  const { data: mySites = [] } = useMySites(open)
  const { data: siteDirectory = [] } = useSiteDirectory(open)

  const memberSiteIds = useMemo(() => buildMemberSiteIdSet(mySites.map((site) => site.id)), [mySites])
  const defaultToSiteId = resolveDefaultToSiteId(
    siteDirectory.map((site) => site.id),
    sessionQuery.data?.activeSiteId,
    mySites.map((site) => site.id),
  )

  const [fromSiteId, setFromSiteId] = useState('')
  const [toSiteId, setToSiteId] = useState(defaultToSiteId)
  const [searchQuery, setSearchQuery] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])

  const showSourceBin = canSuggestSourceBin(fromSiteId, memberSiteIds)
  const { data: locations = [] } = useLocations({ enabled: open && showSourceBin })
  const { data: inventoryResponse, isFetching: isSearchingInventory } = useInventory(
    { search: searchQuery, pageSize: 8 },
    { enabled: open && searchQuery.trim().length > 0 },
  )

  useEffect(() => {
    if (!open) return
    setToSiteId(defaultToSiteId)
  }, [open, defaultToSiteId])

  const reset = () => {
    setFromSiteId('')
    setToSiteId(defaultToSiteId)
    setSearchQuery('')
    setLines([])
  }

  const addLine = (item: { id: string; sku: string; name: string }) => {
    if (lines.some((line) => line.catalogItemId === item.id)) {
      toast.error(t('inventory:stockTransfers.create.partAlreadyAdded'))
      return
    }
    setLines((current) => [
      ...current,
      { catalogItemId: item.id, sku: item.sku, name: item.name, requestedQty: '1' },
    ])
    setSearchQuery('')
  }

  const updateLine = (catalogItemId: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((entry) => (entry.catalogItemId === catalogItemId ? { ...entry, ...patch } : entry)))

  return {
    fromSiteId,
    setFromSiteId,
    toSiteId,
    setToSiteId,
    searchQuery,
    setSearchQuery,
    lines,
    addLine,
    updateLine,
    reset,
    showSourceBin,
    sourceBins: locations.filter((location) => location.type === 'bin'),
    inventoryResults: inventoryResponse?.data ?? [],
    isSearchingInventory,
    availableFromSites: siteDirectory.filter((site) => site.id !== toSiteId),
    availableToSites: siteDirectory.filter((site) => site.id !== fromSiteId),
  }
}
