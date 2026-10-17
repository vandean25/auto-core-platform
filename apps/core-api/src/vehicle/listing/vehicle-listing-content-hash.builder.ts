import { Prisma } from '@prisma/client';
import type {
  VehicleListing,
  VehicleListingChannel,
  VehicleListingPhoto,
  VehicleMedia,
  Vehicle,
} from '@prisma/client';
import {
  type VehicleListingContentHashInput,
  type VehicleListingContentHashVehicleRow,
  computeVehicleListingContentSha256,
} from './vehicle-listing-content-hash.js';

import Decimal = Prisma.Decimal;

type HashDbClient = Pick<
  Prisma.TransactionClient,
  | 'vehicleEquipmentSelection'
  | 'vehicleEquipmentFreeTextItem'
  | 'vehicleMedia'
  | 'vehicle'
>;

export function formatListingPriceForHash(
  value: Decimal | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  return value.toFixed(2);
}

export function formatFirstRegistrationForHash(
  value: Date | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  return value.toISOString().slice(0, 10);
}

export function vehicleRowForContentHash(
  vehicle: Pick<
    Vehicle,
    | 'make'
    | 'model'
    | 'year'
    | 'mileage'
    | 'fuel_type'
    | 'power_kw'
    | 'first_registration_date'
    | 'co2_wltp_g_km'
    | 'co2_nedc_g_km'
    | 'color'
    | 'emission_class'
  >,
): VehicleListingContentHashVehicleRow {
  return {
    make: vehicle.make,
    model: vehicle.model,
    model_year: vehicle.year,
    mileage_km: vehicle.mileage,
    fuel: vehicle.fuel_type,
    power_kw: vehicle.power_kw,
    first_registration: formatFirstRegistrationForHash(
      vehicle.first_registration_date,
    ),
    co2_wltp_g_km: vehicle.co2_wltp_g_km,
    co2_nedc_g_km: vehicle.co2_nedc_g_km,
    color: vehicle.color,
    emission_class: vehicle.emission_class,
  };
}

export async function buildVehicleListingContentHashInput(
  prisma: HashDbClient,
  params: {
    tenantId: string;
    siteId: string;
    vehicleId: string;
    stockPurchaseId: string;
    listingRef: string;
    listing: Pick<
      VehicleListing,
      | 'title'
      | 'description'
      | 'description_language'
      | 'price_gross_eur'
      | 'vat_display'
      | 'nova_included_confirmed'
      | 'mandatory_fees_included_confirmed'
      | 'equipment_free_text'
      | 'portal_category'
      | 'export_assertion_damage_free'
      | 'export_assertion_metallic'
      | 'export_assertion_guarantee'
      | 'export_assertion_jahreswagen'
      | 'export_assertion_recommendation'
      | 'export_assertion_demo_vehicle'
    > | null;
    photoMediaIds: string[];
    channels: Pick<
      VehicleListingChannel,
      'platform' | 'serializer_profile' | 'mapping_version'
    >[];
  },
): Promise<VehicleListingContentHashInput> {
  const [vehicle, selections, freeTextItems] = await Promise.all([
    prisma.vehicle.findFirst({
      where: { tenant_id: params.tenantId, id: params.vehicleId },
      select: {
        make: true,
        model: true,
        year: true,
        mileage: true,
        fuel_type: true,
        power_kw: true,
        first_registration_date: true,
        co2_wltp_g_km: true,
        co2_nedc_g_km: true,
        color: true,
        emission_class: true,
      },
    }),
    prisma.vehicleEquipmentSelection.findMany({
      where: {
        tenant_id: params.tenantId,
        stock_purchase_id: params.stockPurchaseId,
      },
      include: { option: true },
    }),
    prisma.vehicleEquipmentFreeTextItem.findMany({
      where: {
        tenant_id: params.tenantId,
        stock_purchase_id: params.stockPurchaseId,
      },
      orderBy: { sort_order: 'asc' },
    }),
  ]);

  if (!vehicle) {
    throw new Error(`Vehicle ${params.vehicleId} not found for listing hash`);
  }

  const mediaRows =
    params.photoMediaIds.length === 0
      ? []
      : await prisma.vehicleMedia.findMany({
          where: {
            tenant_id: params.tenantId,
            site_id: params.siteId,
            vehicle_id: params.vehicleId,
            id: { in: params.photoMediaIds },
          },
        });

  const mediaById = new Map(mediaRows.map((row) => [row.id, row]));
  const photos = params.photoMediaIds
    .map((mediaId, index) => {
      const media = mediaById.get(mediaId);
      if (!media) {
        return null;
      }
      return {
        media_id: mediaId,
        content_sha256: media.content_sha256,
        sort_order: index,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const listing = params.listing;

  return {
    listing_ref: params.listingRef,
    title: listing?.title ?? null,
    description: listing?.description ?? null,
    description_language: listing?.description_language ?? 'DE',
    price_gross_eur: formatListingPriceForHash(
      listing?.price_gross_eur ?? null,
    ),
    vat_display: listing?.vat_display ?? null,
    nova_included_confirmed: listing?.nova_included_confirmed ?? false,
    mandatory_fees_included_confirmed:
      listing?.mandatory_fees_included_confirmed ?? false,
    equipment_free_text: listing?.equipment_free_text ?? null,
    portal_category: listing?.portal_category ?? null,
    export_assertions: {
      damage_free: listing?.export_assertion_damage_free ?? null,
      metallic: listing?.export_assertion_metallic ?? null,
      guarantee: listing?.export_assertion_guarantee ?? null,
      jahreswagen: listing?.export_assertion_jahreswagen ?? null,
      recommendation: listing?.export_assertion_recommendation ?? null,
      demo_vehicle: listing?.export_assertion_demo_vehicle ?? null,
    },
    equipment: selections.map((row) => ({
      code: row.option.code,
      assertion: row.assertion,
    })),
    equipment_free_text_lines: freeTextItems.map((row) => ({
      sort_order: row.sort_order,
      text: row.text,
    })),
    photos,
    channels: params.channels.map((row) => ({
      platform: row.platform,
      serializer_profile: row.serializer_profile,
      mapping_version: row.mapping_version,
    })),
    vehicle: vehicleRowForContentHash(vehicle),
  };
}

export async function computeListingContentSha256FromDb(
  prisma: HashDbClient,
  params: {
    tenantId: string;
    siteId: string;
    vehicleId: string;
    stockPurchaseId: string;
    listingRef: string;
    listing: Pick<
      VehicleListing,
      | 'title'
      | 'description'
      | 'description_language'
      | 'price_gross_eur'
      | 'vat_display'
      | 'nova_included_confirmed'
      | 'mandatory_fees_included_confirmed'
      | 'equipment_free_text'
      | 'portal_category'
      | 'export_assertion_damage_free'
      | 'export_assertion_metallic'
      | 'export_assertion_guarantee'
      | 'export_assertion_jahreswagen'
      | 'export_assertion_recommendation'
      | 'export_assertion_demo_vehicle'
    > | null;
    photoMediaIds: string[];
    channels: Pick<
      VehicleListingChannel,
      'platform' | 'serializer_profile' | 'mapping_version'
    >[];
  },
): Promise<string> {
  const input = await buildVehicleListingContentHashInput(prisma, params);
  return computeVehicleListingContentSha256(input);
}

export type ListingWithHashRelations = VehicleListing & {
  photos: (VehicleListingPhoto & { media: VehicleMedia })[];
  channels: VehicleListingChannel[];
};

export function photoMediaIdsForListing(
  listing: ListingWithHashRelations,
): string[] {
  return listing.photos
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row) => row.media_id);
}
