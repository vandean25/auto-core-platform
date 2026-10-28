// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { localizedCopy, VEHICLE_REGULATORY_SECTION } from './vehicle-regulatory-copy'

describe('vehicle-regulatory-copy', () => {
  it('picks one language instead of showing both', () => {
    expect(localizedCopy(VEHICLE_REGULATORY_SECTION, 'de-AT')).toBe('Zulassung & Emissionen')
    expect(localizedCopy(VEHICLE_REGULATORY_SECTION, 'en')).toBe('Registration & emissions')
  })
})
