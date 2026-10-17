import type { PatchVehicleListingDto, VehicleListingDto } from '@/api/vehicle-listing'

export type ListingDraft = {
  description: string
  description_language: 'DE' | 'EN'
  price_gross_eur: string
  vat_display: 'STANDARD' | 'MARGIN' | ''
  nova_included_confirmed: boolean
  mandatory_fees_included_confirmed: boolean
  equipment_free_text: string
  portal_category: string
  photo_ids: string[]
  export_assertion_damage_free: boolean | null
  export_assertion_metallic: boolean | null
  export_assertion_guarantee: boolean | null
  export_assertion_jahreswagen: boolean | null
  export_assertion_recommendation: boolean | null
  export_assertion_demo_vehicle: boolean | null
}

function asOptionalString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export function listingToDraft(listing: VehicleListingDto): ListingDraft {
  const price = listing.price_display?.price_gross_eur
  return {
    description: asOptionalString(listing.description),
    description_language: listing.description_language,
    price_gross_eur:
      typeof price === 'string' || typeof price === 'number' ? String(price) : '',
    vat_display: listing.price_display?.vat_display ?? '',
    nova_included_confirmed: listing.price_display?.nova_included_confirmed ?? false,
    mandatory_fees_included_confirmed:
      listing.price_display?.mandatory_fees_included_confirmed ?? false,
    equipment_free_text: asOptionalString(listing.equipment_free_text),
    portal_category: asOptionalString(listing.portal_category),
    photo_ids: listing.photos.map((photo) => photo.media_id),
    export_assertion_damage_free: asNullableBoolean(listing.export_assertion_damage_free),
    export_assertion_metallic: asNullableBoolean(listing.export_assertion_metallic),
    export_assertion_guarantee: asNullableBoolean(listing.export_assertion_guarantee),
    export_assertion_jahreswagen: asNullableBoolean(listing.export_assertion_jahreswagen),
    export_assertion_recommendation: asNullableBoolean(
      listing.export_assertion_recommendation,
    ),
    export_assertion_demo_vehicle: asNullableBoolean(listing.export_assertion_demo_vehicle),
  }
}

export function draftToPatchPayload(
  draft: ListingDraft,
  expectedRevision: number,
): PatchVehicleListingDto {
  const price = draft.price_gross_eur.trim()
  const priceNumber = price.length > 0 ? Number.parseFloat(price.replace(',', '.')) : undefined

  return {
    expected_revision: expectedRevision,
    description: draft.description.trim() || null,
    description_language: draft.description_language,
    price_gross_eur: priceNumber,
    vat_display: draft.vat_display || undefined,
    nova_included_confirmed: draft.nova_included_confirmed,
    mandatory_fees_included_confirmed: draft.mandatory_fees_included_confirmed,
    equipment_free_text: draft.equipment_free_text.trim() || null,
    portal_category: draft.portal_category.trim() || null,
    photo_ids: draft.photo_ids,
    export_assertion_damage_free: draft.export_assertion_damage_free,
    export_assertion_metallic: draft.export_assertion_metallic,
    export_assertion_guarantee: draft.export_assertion_guarantee,
    export_assertion_jahreswagen: draft.export_assertion_jahreswagen,
    export_assertion_recommendation: draft.export_assertion_recommendation,
    export_assertion_demo_vehicle: draft.export_assertion_demo_vehicle,
  } as unknown as PatchVehicleListingDto
}

export function draftsEqual(a: ListingDraft, b: ListingDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
