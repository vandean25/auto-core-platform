import { describe, expect, it } from 'vitest'
import {
  getCatalogSourceBannerCopy,
  getFallbackDialogCopy,
  findOemConcernForMakeBrandId,
  isVehicleIdentityStale,
  toCatalogSourceMetadata,
} from './catalog-source-copy'

describe('catalog-source-copy', () => {
  it('maps OEM hit metadata to banner copy', () => {
    const metadata = toCatalogSourceMetadata('PARTS', {
      sourceUsed: 'OEM',
      oemStatus: 'HIT',
      fallbackReason: null,
    })

    expect(getCatalogSourceBannerCopy(metadata, 'STELLANTIS')).toBe(
      'Parts: OEM catalog (Stellantis)',
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

    expect(getCatalogSourceBannerCopy(emptyMetadata)).toContain('no results')
    expect(getCatalogSourceBannerCopy(errorMetadata)).toContain('unavailable')
    expect(getFallbackDialogCopy('EMPTY').title).toBe('No OEM results')
    expect(getFallbackDialogCopy('ERROR').title).toBe('OEM catalog unavailable')
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
