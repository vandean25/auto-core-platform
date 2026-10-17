import type {
  VehicleListing,
  VehicleListingChannel,
  VehicleListingPhoto,
  VehicleMedia,
} from '@prisma/client';
import { resolveVehicleEquipmentForProfile } from '../equipment/vehicle-equipment-portal-map.resolver.js';
import type { EquipmentListingSerializerProfile } from '../equipment/vehicle-equipment-portal-map.types.js';
import {
  mobileDeImageFilename,
  mobileDeImageIdFromListingRef,
} from './mobile-de-layout.manifest.js';
import type {
  ListingSerializerImageInput,
  ListingSerializerInput,
} from './listing-serializer.types.js';

export const MOBILE_DE_REFERENCE_DEFAULT_CATEGORY = 'Car.Limousine';

type ListingWithRelations = VehicleListing & {
  photos: (VehicleListingPhoto & { media: VehicleMedia })[];
  channels: VehicleListingChannel[];
};

export function buildListingSerializerInput(params: {
  profileCode: EquipmentListingSerializerProfile;
  mappingVersion: string;
  generatedAt: Date;
  listing: ListingWithRelations;
  vehicle: {
    make: string;
    model: string;
    year: number;
    mileage: number | null;
    fuel_type: string | null;
    power_kw: number | null;
    first_registration_date: Date | null;
    co2_wltp_g_km: number | null;
    co2_nedc_g_km: number | null;
    color: string | null;
    emission_class: string | null;
  };
  equipmentSelections: Array<{
    code: string;
    label_de: string;
    label_en: string;
    assertion: 'PRESENT' | 'ABSENT';
  }>;
  equipmentFreeTextLines: string[];
  imageBytesByMediaId: Map<string, Buffer>;
  category?: string;
}): ListingSerializerInput {
  const equipment = resolveVehicleEquipmentForProfile(
    params.profileCode,
    {
      selections: params.equipmentSelections,
      freeTextLines: params.equipmentFreeTextLines,
    },
    params.mappingVersion,
  );

  const imageId = mobileDeImageIdFromListingRef(params.listing.listing_ref);
  const images: ListingSerializerImageInput[] = params.listing.photos
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .slice(0, 15)
    .map((photo, index) => {
      const sequence = index + 1;
      const bytes = params.imageBytesByMediaId.get(photo.media_id);
      if (!bytes) {
        throw new Error(`Missing image bytes for media ${photo.media_id}`);
      }
      return {
        sequence,
        filename: mobileDeImageFilename(imageId, sequence),
        bytes,
        content_sha256: photo.media.content_sha256,
      };
    });

  const price = params.listing.price_gross_eur;
  if (!price || !params.listing.vat_display) {
    throw new Error('Listing price and VAT display are required for export.');
  }

  return {
    generatedAt: params.generatedAt,
    profileCode: params.profileCode,
    mappingVersion: params.mappingVersion,
    listingRef: params.listing.listing_ref,
    vehicle: {
      make: params.vehicle.make,
      model: params.vehicle.model,
      model_year: params.vehicle.year,
      mileage_km: params.vehicle.mileage ?? 0,
      fuel: params.vehicle.fuel_type,
      power_kw: params.vehicle.power_kw,
      first_registration:
        params.vehicle.first_registration_date?.toISOString().slice(0, 10) ??
        null,
      color: params.vehicle.color,
      co2_wltp_g_km: params.vehicle.co2_wltp_g_km,
      co2_nedc_g_km: params.vehicle.co2_nedc_g_km,
      emission_class: params.vehicle.emission_class,
    },
    listing: {
      title: params.listing.title,
      description: params.listing.description,
      price_gross_eur: price.toFixed(2),
      vat_display: params.listing.vat_display,
      category: params.category ?? MOBILE_DE_REFERENCE_DEFAULT_CATEGORY,
    },
    equipment,
    images,
  };
}
