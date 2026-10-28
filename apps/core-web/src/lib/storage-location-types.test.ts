import { describe, expect, it } from 'vitest'

import type { components } from '@/api/generated/openapi'
import deSettings from '../../../../locales/de/settings.json'
import enSettings from '../../../../locales/en/settings.json'

type LocationType = components['schemas']['LocationParentResponseDto']['type']

// Compile-time exhaustiveness: adding an API location type breaks this map until the locales cover it.
const LOCATION_TYPES: Record<LocationType, true> = {
  warehouse: true,
  aisle: true,
  shelf: true,
  bin: true,
  customer_storage: true,
  staging_tote: true,
  vehicle_lot: true,
  in_transit: true,
}

describe('storage location type labels', () => {
  it.each([
    ['de', deSettings],
    ['en', enSettings],
  ])('%s has a label for every API location type', (_language, settings) => {
    const labels = settings.storageLocations.types as Record<string, string>
    for (const type of Object.keys(LOCATION_TYPES)) {
      expect(labels[type], type).toBeTruthy()
    }
    expect(Object.keys(labels).sort()).toEqual(Object.keys(LOCATION_TYPES).sort())
  })
})
