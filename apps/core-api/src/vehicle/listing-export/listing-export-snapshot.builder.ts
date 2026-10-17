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
  /** When true, missing image bytes use an empty buffer (validation-only snapshot). */
  allowMissingImageBytes?: boolean;
  /** When true, missing price/VAT use placeholders so serializer validation can run. */
  allowIncompleteListing?: boolean;
}): ListingSerializerInput {
  const listingFreeTextLines =
    params.listing.equipment_free_text
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0) ?? [];

  const equipment = resolveVehicleEquipmentForProfile(
    params.profileCode,
    {
      selections: params.equipmentSelections,
      freeTextLines: params.equipmentFreeTextLines,
      passThroughFreeText: listingFreeTextLines,
    },
    params.mappingVersion,
  );

  const imageId = mobileDeImageIdFromListingRef(params.listing.listing_ref);
  const images: ListingSerializerImageInput[] = params.listing.photos
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((photo, index) => {
      const sequence = index + 1;
      const bytes = params.imageBytesByMediaId.get(photo.media_id);
      if (!bytes) {
        if (params.allowMissingImageBytes) {
          return {
            sequence,
            filename: mobileDeImageFilename(imageId, sequence),
            bytes: Buffer.alloc(0),
            content_sha256: photo.media.content_sha256,
          };
        }
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
  const vatDisplay = params.listing.vat_display;
  if (!price || !vatDisplay) {
    if (!params.allowIncompleteListing) {
      throw new Error('Listing price and VAT display are required for export.');
    }
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
      mileage_km: params.vehicle.mileage,
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
      price_gross_eur: price ? price.toFixed(2) : '0.01',
      vat_display: vatDisplay ?? 'STANDARD',
      category: params.listing.portal_category?.trim() ?? '',
    },
    exportAssertions: {
      damage_free: params.listing.export_assertion_damage_free,
      metallic: params.listing.export_assertion_metallic,
      guarantee: params.listing.export_assertion_guarantee,
      jahreswagen: params.listing.export_assertion_jahreswagen,
      recommendation: params.listing.export_assertion_recommendation,
      demo_vehicle: params.listing.export_assertion_demo_vehicle,
    },
    equipment,
    images,
  };
}
