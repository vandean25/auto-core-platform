import type {
  CatalogProviderOemConcern,
  CatalogSearchConcern,
  Vehicle,
} from '@/api/types'
import { i18n } from '@/lib/i18n'

export interface CatalogSourceMetadata {
  concern: CatalogSearchConcern
  sourceUsed: 'OEM' | 'AFTERMARKET'
  oemStatus: 'HIT' | 'EMPTY' | 'ERROR' | 'NOT_CONFIGURED'
  fallbackReason: 'EMPTY' | 'ERROR' | null
}

export type CatalogSearchSession = {
  parts: CatalogSourceMetadata | null
  labor: CatalogSourceMetadata | null
}

export function createEmptyCatalogSearchSession(): CatalogSearchSession {
  return { parts: null, labor: null }
}

export function toCatalogSourceMetadata(
  concern: CatalogSearchConcern,
  response: {
    sourceUsed: CatalogSourceMetadata['sourceUsed']
    oemStatus: CatalogSourceMetadata['oemStatus']
    fallbackReason: CatalogSourceMetadata['fallbackReason']
  },
): CatalogSourceMetadata {
  return {
    concern,
    sourceUsed: response.sourceUsed,
    oemStatus: response.oemStatus,
    fallbackReason: response.fallbackReason,
  }
}

export function getConcernLabel(concern: CatalogSearchConcern): string {
  return i18n.t(`catalog.concern.${concern}`, { ns: 'workshop' })
}

export function getOemConcernLabel(code: CatalogProviderOemConcern['code']): string {
  const key = `catalog.oem.${code}` as const
  const translated = i18n.t(key, { ns: 'workshop', defaultValue: '' })
  if (translated) return translated
  return code
}

export function findOemConcernForMakeBrandId(
  makeBrandId: number | null | undefined,
  oemConcerns: CatalogProviderOemConcern[] | undefined,
): CatalogProviderOemConcern | null {
  if (!makeBrandId || !oemConcerns) return null
  return oemConcerns.find((concern) =>
    concern.memberMakes.some((make) => make.id === makeBrandId),
  ) ?? null
}

export function isVehicleIdentityStale(vehicle: Vehicle | undefined): boolean {
  if (!vehicle) return true
  return (
    vehicle.make_brand_id == null ||
    !vehicle.identity_input_fingerprint ||
    !vehicle.identity_resolved_at
  )
}

export function formatIdentityKeys(keys: Record<string, unknown> | null | undefined): string {
  if (!keys) return i18n.t('catalog.identity.noKeys', { ns: 'workshop' })
  const entries = Object.entries(keys)
  if (entries.length === 0) return i18n.t('catalog.identity.noKeys', { ns: 'workshop' })
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ')
}

export function getCatalogSourceBannerCopy(
  metadata: CatalogSourceMetadata,
  oemConcernCode?: CatalogProviderOemConcern['code'] | null,
): string {
  const concernLabel = getConcernLabel(metadata.concern)

  if (metadata.sourceUsed === 'OEM') {
    const concernSuffix = oemConcernCode
      ? i18n.t('catalog.banner.oemSuffix', {
          ns: 'workshop',
          label: getOemConcernLabel(oemConcernCode),
        })
      : ''
    return i18n.t('catalog.banner.oem', { ns: 'workshop', concern: concernLabel, suffix: concernSuffix })
  }

  if (metadata.fallbackReason === 'EMPTY') {
    return i18n.t('catalog.banner.fallbackEmpty', { ns: 'workshop', concern: concernLabel })
  }

  if (metadata.fallbackReason === 'ERROR') {
    return i18n.t('catalog.banner.fallbackError', { ns: 'workshop', concern: concernLabel })
  }

  if (metadata.oemStatus === 'NOT_CONFIGURED') {
    return i18n.t('catalog.banner.notConfigured', { ns: 'workshop', concern: concernLabel })
  }

  return i18n.t('catalog.banner.aftermarket', { ns: 'workshop', concern: concernLabel })
}

export function getFallbackDialogCopy(fallbackReason: 'EMPTY' | 'ERROR'): {
  title: string
  description: string
} {
  if (fallbackReason === 'EMPTY') {
    return {
      title: i18n.t('catalog.fallbackDialog.emptyTitle', { ns: 'workshop' }),
      description: i18n.t('catalog.fallbackDialog.emptyDescription', { ns: 'workshop' }),
    }
  }

  return {
    title: i18n.t('catalog.fallbackDialog.errorTitle', { ns: 'workshop' }),
    description: i18n.t('catalog.fallbackDialog.errorDescription', { ns: 'workshop' }),
  }
}
