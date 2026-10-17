import { createHash } from 'node:crypto';
import type { VehicleListingVatDisplay } from '@prisma/client';
import { VEHICLE_LISTING_PLATFORM_DEFAULTS } from './vehicle-listing-platform.defaults.js';

export const VEHICLE_LISTING_CONTENT_HASH_SCHEMA_VERSION = 1;

export interface VehicleListingContentHashEquipmentRow {
  code: string;
  assertion: 'PRESENT' | 'ABSENT';
}

export interface VehicleListingContentHashPhotoRow {
  media_id: string;
  content_sha256: string;
  sort_order: number;
}

export interface VehicleListingContentHashChannelRow {
  platform: string;
  serializer_profile: string;
  mapping_version: string;
}

export interface VehicleListingContentHashInput {
  listing_ref: string;
  title: string | null;
  description: string | null;
  description_language: string;
  price_gross_eur: string | null;
  vat_display: VehicleListingVatDisplay | null;
  nova_included_confirmed: boolean;
  mandatory_fees_included_confirmed: boolean;
  equipment_free_text: string | null;
  equipment: VehicleListingContentHashEquipmentRow[];
  photos: VehicleListingContentHashPhotoRow[];
  channels: VehicleListingContentHashChannelRow[];
}

function sortedEquipment(
  rows: VehicleListingContentHashEquipmentRow[],
): VehicleListingContentHashEquipmentRow[] {
  return [...rows].sort((a, b) => a.code.localeCompare(b.code));
}

function sortedPhotos(
  rows: VehicleListingContentHashPhotoRow[],
): VehicleListingContentHashPhotoRow[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

function sortedChannels(
  rows: VehicleListingContentHashChannelRow[],
): VehicleListingContentHashChannelRow[] {
  return [...rows].sort((a, b) => a.platform.localeCompare(b.platform));
}

export function buildVehicleListingContentHashPayload(
  input: VehicleListingContentHashInput,
): Record<string, unknown> {
  return {
    schema_version: VEHICLE_LISTING_CONTENT_HASH_SCHEMA_VERSION,
    listing_ref: input.listing_ref,
    title: input.title,
    description: input.description,
    description_language: input.description_language,
    price_gross_eur: input.price_gross_eur,
    vat_display: input.vat_display,
    nova_included_confirmed: input.nova_included_confirmed,
    mandatory_fees_included_confirmed: input.mandatory_fees_included_confirmed,
    equipment_free_text: input.equipment_free_text,
    equipment: sortedEquipment(input.equipment),
    photos: sortedPhotos(input.photos),
    channels: sortedChannels(input.channels),
  };
}

export function computeVehicleListingContentSha256(
  input: VehicleListingContentHashInput,
): string {
  const payload = buildVehicleListingContentHashPayload(input);
  const canonical = JSON.stringify(payload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Empty listing cycle defaults (used on create before advisor input). */
export function emptyVehicleListingContentSha256(listingRef: string): string {
  return computeVehicleListingContentSha256({
    listing_ref: listingRef,
    title: null,
    description: null,
    description_language: 'DE',
    price_gross_eur: null,
    vat_display: null,
    nova_included_confirmed: false,
    mandatory_fees_included_confirmed: false,
    equipment_free_text: null,
    equipment: [],
    photos: [],
    channels: VEHICLE_LISTING_PLATFORM_DEFAULTS.map((row) => ({
      platform: row.platform,
      serializer_profile: row.serializer_profile,
      mapping_version: row.mapping_version,
    })),
  });
}
