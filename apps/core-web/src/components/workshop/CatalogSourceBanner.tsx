import { AlertTriangle, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { CatalogProviderOemConcern } from '@/api/types'
import {
  getCatalogSourceBannerCopy,
  type CatalogSourceMetadata,
} from '@/features/workshop/catalog-source-copy'

export interface CatalogSourceBannerProps {
  metadata: CatalogSourceMetadata
  oemConcernCode?: CatalogProviderOemConcern['code'] | null
  compact?: boolean
}

function getVariant(metadata: CatalogSourceMetadata): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (metadata.fallbackReason === 'ERROR') return 'destructive'
  if (metadata.fallbackReason === 'EMPTY') return 'secondary'
  if (metadata.sourceUsed === 'OEM') return 'default'
  return 'outline'
}

export function CatalogSourceBanner({
  metadata,
  oemConcernCode,
  compact = false,
}: CatalogSourceBannerProps) {
  const copy = getCatalogSourceBannerCopy(metadata, oemConcernCode)
  const Icon = metadata.fallbackReason === 'ERROR' ? AlertTriangle : Info

  if (compact) {
    return (
      <Badge
        variant={getVariant(metadata)}
        className='max-w-full truncate font-normal'
        data-testid={`catalog-source-banner-${metadata.concern.toLowerCase()}`}
        title={copy}
      >
        {copy}
      </Badge>
    )
  }

  return (
    <div
      className='flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm'
      data-testid={`catalog-source-banner-${metadata.concern.toLowerCase()}`}
    >
      <Icon className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
      <p className='text-muted-foreground'>{copy}</p>
    </div>
  )
}
