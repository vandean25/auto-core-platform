import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { InventoryItem } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency } from '@/lib/format'

export type ItemFieldProps = {
  item: InventoryItem
  editable: boolean
  onChange?: (patch: Partial<InventoryItem>) => void
}

const NO_BRAND = '__none'

function FieldLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase">{children}</p>
}

function Hint({ show, children }: { show: boolean; children: ReactNode }) {
  return show ? <p className="text-xs text-muted-foreground">{children}</p> : null
}

export function SkuField({ item, editable }: Pick<ItemFieldProps, 'item' | 'editable'>) {
  const { t } = useTranslation('inventory')

  return (
    <div className="space-y-1">
      <FieldLabel>{t('dialogs.editItem.sku')}</FieldLabel>
      <p className="font-semibold">{item.sku}</p>
      <Hint show={editable}>{t('itemInfoCard.skuLockedHint')}</Hint>
    </div>
  )
}

export function BrandField({
  item,
  editable,
  onChange,
  brandList,
}: ItemFieldProps & { brandList: Array<{ id: number; name: string }> }) {
  const { t } = useTranslation('inventory')
  const selectedBrandId = item.brand_id ?? brandList.find((brand) => brand.name === item.brand)?.id

  const handleValueChange = (value: string) => {
    if (value === NO_BRAND) {
      onChange?.({ brand: '', brand_id: undefined })
      return
    }
    const selected = brandList.find((brand) => String(brand.id) === value)
    onChange?.({
      brand: selected?.name ?? item.brand,
      brand_id: selected?.id ?? item.brand_id,
    })
  }

  return (
    <div className="space-y-1">
      <FieldLabel>{t('itemInfoCard.brand')}</FieldLabel>
      {editable ? (
        <Select value={selectedBrandId ? String(selectedBrandId) : NO_BRAND} onValueChange={handleValueChange}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder={t('itemInfoCard.selectBrand')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_BRAND}>{t('itemInfoCard.noBrand')}</SelectItem>
            {brandList.map((brand) => (
              <SelectItem key={brand.id} value={String(brand.id)}>
                {brand.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="font-semibold">{item.brand}</p>
      )}
    </div>
  )
}

export function NameField({ item, editable, onChange }: ItemFieldProps) {
  const { t } = useTranslation('inventory')

  return (
    <div className="space-y-1">
      <FieldLabel>{t('itemInfoCard.name')}</FieldLabel>
      {editable ? (
        <Input value={item.name} onChange={(event) => onChange?.({ name: event.target.value })} className="h-8" />
      ) : (
        <p>{item.name}</p>
      )}
    </div>
  )
}

export function PriceField({ item, editable, onChange }: ItemFieldProps) {
  const { t } = useTranslation('inventory')

  return (
    <div className="space-y-1">
      <FieldLabel>{t('itemInfoCard.price')}</FieldLabel>
      {editable ? (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            EUR
          </span>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={item.price}
            onChange={(event) => {
              const value = Number(event.target.value)
              onChange?.({ price: Number.isNaN(value) ? 0 : Math.max(0, value) })
            }}
            className="h-8 pl-14"
          />
        </div>
      ) : (
        <p className="text-lg font-bold">{formatCurrency(item.price)}</p>
      )}
    </div>
  )
}

export function AvailabilityField({ item, editable }: Pick<ItemFieldProps, 'item' | 'editable'>) {
  const { t } = useTranslation('inventory')

  return (
    <div className="space-y-1">
      <FieldLabel>{t('itemInfoCard.availability')}</FieldLabel>
      <div className="flex items-center gap-2 mt-1">
        <StatusBadge status={item.status} />
        <span className="text-sm font-medium">({t('shared.units', { count: item.quantity_available })})</span>
      </div>
      <Hint show={editable}>{t('itemInfoCard.availabilityReadOnlyHint')}</Hint>
    </div>
  )
}

export function CategoryField({ item, editable, onChange }: ItemFieldProps) {
  const { t } = useTranslation('inventory')

  if (!editable && !item.category) return null

  return (
    <div className="space-y-1">
      <FieldLabel>{t('itemInfoCard.category')}</FieldLabel>
      {editable ? (
        <Input
          value={item.category ?? ''}
          onChange={(event) => onChange?.({ category: event.target.value || undefined })}
          className="h-8"
        />
      ) : (
        <Badge variant="secondary" className="mt-1">
          {item.category}
        </Badge>
      )}
    </div>
  )
}

export function LocationField({ item, editable }: Pick<ItemFieldProps, 'item' | 'editable'>) {
  const { t } = useTranslation('inventory')

  if (!editable && !item.warehouse_location) return null

  return (
    <div className="space-y-1">
      <FieldLabel>{t('itemInfoCard.location')}</FieldLabel>
      <p className="text-sm text-muted-foreground font-medium">
        {item.warehouse_location ?? t('itemInfoCard.notAvailable')}
      </p>
      <Hint show={editable}>{t('itemInfoCard.transferWorkflowHint')}</Hint>
    </div>
  )
}
