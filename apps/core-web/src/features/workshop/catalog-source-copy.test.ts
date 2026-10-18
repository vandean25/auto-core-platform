// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import {
  getCatalogSourceBannerCopy,
  getFallbackDialogCopy,
  findOemConcernForMakeBrandId,
  isVehicleIdentityStale,
  toCatalogSourceMetadata,
} from './catalog-source-copy'

describe('catalog-source-copy', () => {
  beforeAll(async () => {
    await ensureNamespaceLoaded('workshop')
  })

  it('maps OEM hit metadata to banner copy', () => {
    const metadata = toCatalogSourceMetadata('PARTS', {
      sourceUsed: 'OEM',
      oemStatus: 'HIT',
      fallbackReason: null,
    })

    expect(getCatalogSourceBannerCopy(metadata, 'STELLANTIS')).toBe(
      i18n.t('catalog.banner.oem', {
        ns: 'workshop',
        concern: i18n.t('catalog.concern.PARTS', { ns: 'workshop' }),
        suffix: i18n.t('catalog.banner.oemSuffix', {
          ns: 'workshop',
          label: i18n.t('catalog.oem.STELLANTIS', { ns: 'workshop' }),
        }),
      }),
    )
  })

  it('distinguishes empty vs error fallback copy', () => {
    const emptyMetadata = toCatalogSourceMetadata('LABOR', {
      sourceUsed: 'AFTERMARKET',
      oemStatus: 'EMPTY',
      fallbackReason: 'EMPTY',
    })
    const errorMetadata = toCatalogSourceMetadata('LABOR', {
      sourceUsed: 'AFTERMARKET',
      oemStatus: 'ERROR',
      fallbackReason: 'ERROR',
    })

    expect(getCatalogSourceBannerCopy(emptyMetadata)).toContain('Originalteile ohne Treffer')
    expect(getCatalogSourceBannerCopy(errorMetadata)).toContain('Originalteile-Katalog nicht verfügbar')
    expect(getFallbackDialogCopy('EMPTY').title).toBe(
      i18n.t('catalog.fallbackDialog.emptyTitle', { ns: 'workshop' }),
    )
    expect(getFallbackDialogCopy('ERROR').title).toBe(
      i18n.t('catalog.fallbackDialog.errorTitle', { ns: 'workshop' }),
    )
  })

  it('finds OEM concern by make brand id', () => {
    const concern = findOemConcernForMakeBrandId(42, [
      {
        code: 'STELLANTIS',
        hasPartsCredential: true,
        hasLaborCredential: true,
        memberMakes: [{ id: 42, name: 'Peugeot' }],
      },
    ])

    expect(concern?.code).toBe('STELLANTIS')
  })

  it('detects stale vehicle identity', () => {
    expect(
      isVehicleIdentityStale({
        id: 'veh-1',
        make: 'Peugeot',
        model: '308',
        year: 2020,
        make_brand_id: null,
        identity_input_fingerprint: null,
        identity_resolved_at: null,
      }),
    ).toBe(true)

    expect(
      isVehicleIdentityStale({
        id: 'veh-1',
        make: 'Peugeot',
        model: '308',
        year: 2020,
        make_brand_id: 42,
        identity_input_fingerprint: 'fp',
        identity_resolved_at: '2026-08-31T10:00:00.000Z',
      }),
    ).toBe(false)
  })
})
