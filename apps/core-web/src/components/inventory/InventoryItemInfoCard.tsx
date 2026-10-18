import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { InventoryItem } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'

const formatPrice = (amount: number) => formatCurrency(amount)

interface InventoryItemInfoCardProps {
  item: InventoryItem
  action?: ReactNode
  variant?: 'compact' | 'expanded'
  className?: string
  contentClassName?: string
  editable?: boolean
  onChange?: (patch: Partial<InventoryItem>) => void
  brandOptions?: Array<{ id: number; name: string }>
}

export function InventoryItemInfoCard({
  item,
  action,
  variant = 'compact',
  className,
  contentClassName,
  editable = false,
  onChange,
  brandOptions = [],
}: InventoryItemInfoCardProps) {
  const { t } = useTranslation('inventory')
  useEffect(() => {
    void ensureNamespaceLoaded('inventory')
  }, [])

  const isExpanded = variant === 'expanded'
  const brandList = Array.isArray(brandOptions) ? brandOptions : []
  const selectedBrandId = item.brand_id ?? brandList.find((brand) => brand.name === item.brand)?.id

  return (
    <Card className={className}>
      <CardHeader className={cn('flex flex-row items-center justify-between space-y-0', isExpanded && 'items-start')}>
        <div>
          <CardTitle className="text-base font-semibold">{t('itemInfoCard.title')}</CardTitle>
          {isExpanded && (
            <p className="text-xs text-muted-foreground mt-1">{t('itemInfoCard.idLabel', { id: item.id })}</p>
          )}
        </div>
        {action && <div>{action}</div>}
      </CardHeader>
      <CardContent className={cn('space-y-4 text-sm', isExpanded && 'space-y-5', contentClassName)}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase">{t('dialogs.editItem.sku')}</p>
            <p className="font-semibold">{item.sku}</p>
            {editable && <p className="text-xs text-slate-500">{t('itemInfoCard.skuLockedHint')}</p>}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase">{t('itemInfoCard.brand')}</p>
            {editable ? (
              <Select
                value={selectedBrandId ? String(selectedBrandId) : '__none'}
                onValueChange={(value) => {
                  if (value === '__none') {
                    onChange?.({ brand: '', brand_id: undefined })
                    return
                  }
                  const selected = brandList.find((brand) => String(brand.id) === value)
                  onChange?.({
                    brand: selected?.name ?? item.brand,
                    brand_id: selected?.id ?? item.brand_id,
                  })
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={t('itemInfoCard.selectBrand')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t('itemInfoCard.noBrand')}</SelectItem>
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
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500 uppercase">{t('itemInfoCard.name')}</p>
          {editable ? (
            <Input
              value={item.name}
              onChange={(event) => onChange?.({ name: event.target.value })}
              className="h-8"
            />
          ) : (
            <p>{item.name}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase">{t('itemInfoCard.price')}</p>
            {editable ? (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
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
              <p className="text-lg font-bold">{formatPrice(item.price)}</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase">{t('itemInfoCard.availability')}</p>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={item.status} />
              <span className="text-sm font-medium">
                ({t('shared.units', { count: item.quantity_available })})
              </span>
            </div>
            {editable && <p className="text-xs text-slate-500">{t('itemInfoCard.availabilityReadOnlyHint')}</p>}
          </div>
        </div>

        {(editable || item.category) && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase">{t('itemInfoCard.category')}</p>
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
        )}

        {(editable || item.warehouse_location) && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase">{t('itemInfoCard.location')}</p>
            <p className="text-sm text-slate-600 font-medium">
              {item.warehouse_location ?? t('itemInfoCard.notAvailable')}
            </p>
            {editable && <p className="text-xs text-slate-500">{t('itemInfoCard.transferWorkflowHint')}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
