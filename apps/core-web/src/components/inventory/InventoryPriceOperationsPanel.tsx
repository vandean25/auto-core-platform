import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  getSeenPriceOperationKeys,
  mapOperationDtoToStatus,
  markPriceOperationsSeen,
  useFenceInventoryPriceOperation,
  useInventoryPriceOperationsDiscovery,
  type GuardedPriceItemStatus,
  type InventoryPriceOperationDto,
} from '@/api/inventory-price-operations'
import type { InventoryItem } from '@/api/types'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import { GuardedPriceStateBadge } from './GuardedPriceStateBadge'

type OperationActionsProps = {
  operation: InventoryPriceOperationDto
  status: GuardedPriceItemStatus
  isFencing: boolean
  onFence: (op: InventoryPriceOperationDto) => void
  onMarkSeen: (key: string) => void
  onNewPreview?: (item: Pick<InventoryItem, 'id' | 'sku' | 'name'>) => void
}

function PriceOperationActions({
  operation,
  status,
  isFencing,
  onFence,
  onMarkSeen,
  onNewPreview,
}: OperationActionsProps) {
  const { t } = useTranslation('inventory')
  const isFinal = status !== 'PENDING' && status !== 'UNRESOLVED'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'UNRESOLVED' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-8"
          disabled={isFencing}
          onClick={() => onFence(operation)}
        >
          {isFencing ? t('bulk.adjustPrice.markingNotApplied') : t('bulk.adjustPrice.markNotApplied')}
        </Button>
      ) : null}
      {status === 'CONFLICT' && onNewPreview ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-8"
          onClick={() => onNewPreview({ id: operation.itemId, sku: operation.sku, name: operation.sku })}
        >
          {t('bulk.adjustPrice.newPreview')}
        </Button>
      ) : null}
      {isFinal ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-8"
          onClick={() => onMarkSeen(operation.key)}
        >
          {t('bulk.adjustPrice.discovery.markSeen')}
        </Button>
      ) : null}
    </div>
  )
}

type OperationRowProps = {
  operation: InventoryPriceOperationDto
  statusOverride?: GuardedPriceItemStatus
  isFencing: boolean
  onFence: (op: InventoryPriceOperationDto) => void
  onMarkSeen: (key: string) => void
  onNewPreview?: (item: Pick<InventoryItem, 'id' | 'sku' | 'name'>) => void
}

function PriceOperationRow({
  operation,
  statusOverride,
  isFencing,
  onFence,
  onMarkSeen,
  onNewPreview,
}: OperationRowProps) {
  const { t } = useTranslation('inventory')
  const status = statusOverride ?? mapOperationDtoToStatus(operation)
  const transition = t('bulk.adjustPrice.discovery.priceTransition', {
    basis: formatCurrency(Number(operation.basis_retail_price)),
    target: formatCurrency(Number(operation.retail_price)),
  })

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{operation.sku}</span>
          <GuardedPriceStateBadge status={status} />
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">{transition}</p>
      </div>
      <PriceOperationActions
        operation={operation}
        status={status}
        isFencing={isFencing}
        onFence={onFence}
        onMarkSeen={onMarkSeen}
        onNewPreview={onNewPreview}
      />
    </li>
  )
}

type BannerHeaderProps = {
  count: number
  hasFinal: boolean
  expanded: boolean
  onMarkAllSeen: () => void
  onToggleExpanded: () => void
}

function DiscoveryBannerHeader({ count, hasFinal, expanded, onMarkAllSeen, onToggleExpanded }: BannerHeaderProps) {
  const { t } = useTranslation('inventory')
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium text-foreground">
        {t('bulk.adjustPrice.discovery.bannerTitle', { count })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {hasFinal ? (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={onMarkAllSeen}>
            {t('bulk.adjustPrice.discovery.markAllSeen')}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={onToggleExpanded}>
          {expanded ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
          {expanded ? t('bulk.adjustPrice.discovery.hideDetails') : t('bulk.adjustPrice.discovery.showDetails')}
        </Button>
      </div>
    </div>
  )
}

type PanelProps = {
  enabled: boolean
  onNewPreview?: (item: Pick<InventoryItem, 'id' | 'sku' | 'name'>) => void
}

export function InventoryPriceOperationsPanel({ enabled, onNewPreview }: PanelProps) {
  const { t } = useTranslation('inventory')
  const discovery = useInventoryPriceOperationsDiscovery(enabled)
  const fenceMutation = useFenceInventoryPriceOperation()
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => getSeenPriceOperationKeys())
  const [expanded, setExpanded] = useState(true)
  const [fencingKey, setFencingKey] = useState<string | null>(null)
  const [statusOverrides, setStatusOverrides] = useState<Record<string, GuardedPriceItemStatus>>({})

  const visibleOperations = useMemo(() => {
    const all = discovery.data?.pages.flatMap((page) => page.data) ?? []
    return all.filter((op) => op.state === 'ACCEPTED' || !seenKeys.has(op.key))
  }, [discovery.data, seenKeys])

  if (!enabled || visibleOperations.length === 0) return null

  const finalKeys = visibleOperations.filter((op) => op.state !== 'ACCEPTED').map((op) => op.key)

  const handleMarkSeen = (key: string) => {
    markPriceOperationsSeen([key])
    setSeenKeys((prev) => new Set([...prev, key]))
  }

  const handleMarkAllSeen = () => {
    markPriceOperationsSeen(finalKeys)
    setSeenKeys((prev) => new Set([...prev, ...finalKeys]))
  }

  const handleFence = async (op: InventoryPriceOperationDto) => {
    setFencingKey(op.key)
    try {
      const result = await fenceMutation.mutateAsync({
        key: op.key,
        itemId: op.itemId,
        retail_price: Number(op.retail_price),
        expectedRevision: op.expectedRevision,
      })
      const next =
        result.outcome === 'OUTCOME_UNAVAILABLE'
          ? 'OUTCOME_UNAVAILABLE'
          : result.outcome === 'OPERATION'
            ? mapOperationDtoToStatus(result.operation)
            : null
      if (next) setStatusOverrides((prev) => ({ ...prev, [op.key]: next }))
    } finally {
      setFencingKey(null)
    }
  }

  return (
    <section aria-label={t('bulk.adjustPrice.discovery.panelHeading')} className="mb-4 rounded-md border border-border bg-card p-3">
      <DiscoveryBannerHeader
        count={visibleOperations.length}
        hasFinal={finalKeys.length > 0}
        expanded={expanded}
        onMarkAllSeen={handleMarkAllSeen}
        onToggleExpanded={() => setExpanded((prev) => !prev)}
      />
      {expanded ? (
        <div className="mt-3 space-y-2">
          <ul className="space-y-2">
            {visibleOperations.map((op) => (
              <PriceOperationRow
                key={op.key}
                operation={op}
                statusOverride={statusOverrides[op.key]}
                isFencing={fencingKey === op.key}
                onFence={handleFence}
                onMarkSeen={handleMarkSeen}
                onNewPreview={onNewPreview}
              />
            ))}
          </ul>
          {discovery.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 md:min-h-8"
              disabled={discovery.isFetchingNextPage}
              onClick={() => void discovery.fetchNextPage()}
            >
              {t('bulk.adjustPrice.discovery.loadMore')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
