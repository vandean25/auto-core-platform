import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { InventoryItem } from '@/api/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import {
  AvailabilityField,
  BrandField,
  CategoryField,
  LocationField,
  NameField,
  PriceField,
  SkuField,
} from './inventory-item-info-fields'

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
          <SkuField item={item} editable={editable} />
          <BrandField item={item} editable={editable} onChange={onChange} brandList={brandList} />
        </div>

        <NameField item={item} editable={editable} onChange={onChange} />

        <div className="grid grid-cols-2 gap-4">
          <PriceField item={item} editable={editable} onChange={onChange} />
          <AvailabilityField item={item} editable={editable} />
        </div>

        <CategoryField item={item} editable={editable} onChange={onChange} />
        <LocationField item={item} editable={editable} />
      </CardContent>
    </Card>
  )
}
