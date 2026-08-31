import type {
  CatalogProviderOemConcern,
  CatalogSearchConcern,
  Vehicle,
} from '@/api/types'

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
  return concern === 'PARTS' ? 'Parts' : 'Labor'
}

export function getOemConcernLabel(code: CatalogProviderOemConcern['code']): string {
  if (code === 'STELLANTIS') return 'Stellantis'
  if (code === 'MERCEDES') return 'Mercedes-Benz'
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
  if (!keys) return 'No identity keys'
  const entries = Object.entries(keys)
  if (entries.length === 0) return 'No identity keys'
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
      ? ` (${getOemConcernLabel(oemConcernCode)})`
      : ''
    return `${concernLabel}: OEM catalog${concernSuffix}`
  }

  if (metadata.fallbackReason === 'EMPTY') {
    return `${concernLabel}: OEM returned no results — showing aftermarket catalog`
  }

  if (metadata.fallbackReason === 'ERROR') {
    return `${concernLabel}: OEM unavailable — showing aftermarket catalog`
  }

  if (metadata.oemStatus === 'NOT_CONFIGURED') {
    return `${concernLabel}: No OEM catalog configured — showing aftermarket`
  }

  return `${concernLabel}: Aftermarket catalog`
}

export function getFallbackDialogCopy(fallbackReason: 'EMPTY' | 'ERROR'): {
  title: string
  description: string
} {
  if (fallbackReason === 'EMPTY') {
    return {
      title: 'No OEM results',
      description:
        'The OEM catalog returned no matching parts or labor for this vehicle. Search aftermarket catalog instead?',
    }
  }

  return {
    title: 'OEM catalog unavailable',
    description:
      'The OEM catalog is currently unavailable for this vehicle. Search aftermarket catalog instead?',
  }
}
