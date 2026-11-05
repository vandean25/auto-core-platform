import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type DraftLine = {
  catalogItemId: string
  sku: string
  name: string
  requestedQty: string
  sourceLocationId?: string
}

type Site = { id: string; name: string; code: string }
type SourceBin = { id: string; code: string; name: string }
type PartResult = { id: string; sku: string; name: string }

/** First reason the draft cannot be submitted, as a message; null when it can. */
export function transferDraftBlocker(
  fromSiteId: string,
  toSiteId: string,
  lines: DraftLine[],
  t: TFunction<['inventory', 'common']>,
): string | null {
  if (!fromSiteId || !toSiteId) return t('inventory:stockTransfers.create.selectBothSites')
  if (fromSiteId === toSiteId) return t('inventory:stockTransfers.create.sitesMustDiffer')
  if (lines.length === 0) return t('inventory:stockTransfers.create.addAtLeastOneLine')
  return null
}

/** Request lines for the API; throws with a message when a quantity is not a positive number. */
export function toTransferPayloadLines(lines: DraftLine[], showSourceBin: boolean, t: TFunction<['inventory', 'common']>) {
  return lines.map((line) => {
    const requestedQty = Number(line.requestedQty)
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      throw new Error(t('inventory:stockTransfers.create.invalidQuantityForSku', { sku: line.sku }))
    }

    return {
      catalogItemId: line.catalogItemId,
      requestedQty,
      ...(showSourceBin && line.sourceLocationId ? { sourceLocationId: line.sourceLocationId } : {}),
    }
  })
}

export function SiteSelect({
  id,
  label,
  placeholder,
  value,
  onChange,
  sites,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  sites: Site[]
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {sites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              {site.name} ({site.code})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function PartResults({
  isSearching,
  results,
  onPick,
}: {
  isSearching: boolean
  results: PartResult[]
  onPick: (item: PartResult) => void
}) {
  const { t } = useTranslation(['inventory', 'common'])

  if (isSearching) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">{t('inventory:shared.searching')}</p>
  }
  if (results.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">
        {t('inventory:stockTransfers.create.noMatchingParts')}
      </p>
    )
  }

  return results.map((item) => (
    <button
      key={item.id}
      type="button"
      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50"
      onClick={() => onPick(item)}
    >
      <span className="font-medium">{item.sku}</span>
      <span className="truncate text-muted-foreground">{item.name}</span>
    </button>
  ))
}

export function PartSearch({
  query,
  onQueryChange,
  isSearching,
  results,
  onPick,
}: {
  query: string
  onQueryChange: (value: string) => void
  isSearching: boolean
  results: PartResult[]
  onPick: (item: PartResult) => void
}) {
  const { t } = useTranslation(['inventory', 'common'])

  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor="transfer-part-search">{t('inventory:stockTransfers.create.addParts')}</Label>
      <Input
        id="transfer-part-search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t('inventory:stockTransfers.create.searchPartsPlaceholder')}
      />
      {query.trim().length > 0 ? (
        <div className="max-h-40 overflow-y-auto rounded-md border border-border">
          <PartResults isSearching={isSearching} results={results} onPick={onPick} />
        </div>
      ) : null}
    </div>
  )
}

export function DraftLineRow({
  line,
  showSourceBin,
  sourceBins,
  onChange,
}: {
  line: DraftLine
  showSourceBin: boolean
  sourceBins: SourceBin[]
  onChange: (patch: Partial<DraftLine>) => void
}) {
  const { t } = useTranslation(['inventory', 'common'])

  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
      <div>
        <p className="text-sm font-medium">{line.sku}</p>
        <p className="text-xs text-muted-foreground">{line.name}</p>
      </div>
      <div className="space-y-2">
        <Input
          type="number"
          min="0.001"
          step="0.001"
          value={line.requestedQty}
          onChange={(event) => onChange({ requestedQty: event.target.value })}
          aria-label={t('inventory:stockTransfers.create.requestedQtyAria', { sku: line.sku })}
        />
        {showSourceBin ? (
          <Select value={line.sourceLocationId ?? undefined} onValueChange={(value) => onChange({ sourceLocationId: value })}>
            <SelectTrigger aria-label={t('inventory:stockTransfers.create.sourceBinAria', { sku: line.sku })}>
              <SelectValue placeholder={t('inventory:stockTransfers.create.sourceBinOptional')} />
            </SelectTrigger>
            <SelectContent>
              {sourceBins.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {t('inventory:shared.locationCodeName', { code: location.code, name: location.name })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  )
}
