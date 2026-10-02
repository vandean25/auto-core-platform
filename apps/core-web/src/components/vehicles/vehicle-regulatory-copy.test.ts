import { describe, expect, it } from 'vitest'
import {
  bilingualLabel,
  VEHICLE_REGULATORY_SECTION,
} from './vehicle-regulatory-copy'

describe('vehicle-regulatory-copy', () => {
  it('renders bilingual section title', () => {
    expect(bilingualLabel(VEHICLE_REGULATORY_SECTION)).toBe(
      'Registration & emissions / Zulassung & Emissionen',
    )
  })
})
