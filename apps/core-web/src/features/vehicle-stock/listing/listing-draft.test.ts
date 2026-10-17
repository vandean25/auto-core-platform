import { describe, expect, it } from 'vitest'
import { draftToPatchPayload, listingToDraft } from './listing-draft'
import type { VehicleListingDto } from '@/api/vehicle-listing'

const baseListing = {
  id: 'listing-1',
  site_id: 'site-1',
  vehicle_id: 'vehicle-1',
  stock_purchase_id: 'purchase-1',
  listing_ref: 'Labc123',
  revision: 4,
  description_language: 'DE',
  content_sha256: 'hash',
  photos: [{ media_id: 'photo-1', sort_order: 0, content_sha256: 'p1' }],
  channels: [],
  price_display: {
    price_gross_eur: '14990.00',
    vat_display: 'STANDARD',
    consumer_hint_de: 'inkl. USt.',
    nova_included_confirmed: true,
    mandatory_fees_included_confirmed: true,
  },
  description: 'Synthetic listing text.',
  portal_category: 'Car.Limousine',
  export_assertion_damage_free: true,
  export_assertion_metallic: false,
  export_assertion_guarantee: false,
  export_assertion_jahreswagen: false,
  export_assertion_recommendation: false,
  export_assertion_demo_vehicle: false,
} as unknown as VehicleListingDto

describe('listing-draft', () => {
  it('round-trips listing fields into patch payloads with expected revision', () => {
    const draft = listingToDraft(baseListing)
    const patch = draftToPatchPayload(draft, 4)
    expect(patch.expected_revision).toBe(4)
    expect(patch.photo_ids).toEqual(['photo-1'])
    expect(patch.price_gross_eur).toBe(14990)
    expect(patch.portal_category).toBe('Car.Limousine')
  })
})
