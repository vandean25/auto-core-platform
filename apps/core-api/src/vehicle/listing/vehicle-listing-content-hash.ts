import { createHash } from 'node:crypto';
import type { VehicleListingVatDisplay } from '@prisma/client';

export const VEHICLE_LISTING_CONTENT_HASH_SCHEMA_VERSION = 4;

export interface VehicleListingContentHashEquipmentRow {
  code: string;
  assertion: 'PRESENT' | 'ABSENT';
}

export interface VehicleListingContentHashEquipmentFreeTextRow {
  sort_order: number;
  text: string;
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

export interface VehicleListingContentHashVehicleRow {
  make: string;
  model: string;
  model_year: number;
  mileage_km: number | null;
  fuel: string | null;
  power_kw: number | null;
  first_registration: string | null;
  co2_wltp_g_km: number | null;
  co2_nedc_g_km: number | null;
  color: string | null;
  emission_class: string | null;
}

export interface VehicleListingContentHashExportAssertions {
  damage_free: boolean | null;
  metallic: boolean | null;
  guarantee: boolean | null;
  jahreswagen: boolean | null;
  recommendation: boolean | null;
  demo_vehicle: boolean | null;
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
  portal_category: string | null;
  export_assertions: VehicleListingContentHashExportAssertions;
  equipment: VehicleListingContentHashEquipmentRow[];
  equipment_free_text_lines: VehicleListingContentHashEquipmentFreeTextRow[];
  photos: VehicleListingContentHashPhotoRow[];
  channels: VehicleListingContentHashChannelRow[];
  vehicle: VehicleListingContentHashVehicleRow;
}

function sortedEquipment(
  rows: VehicleListingContentHashEquipmentRow[],
): VehicleListingContentHashEquipmentRow[] {
  return [...rows].sort((a, b) => a.code.localeCompare(b.code));
}

function sortedEquipmentFreeText(
  rows: VehicleListingContentHashEquipmentFreeTextRow[],
): VehicleListingContentHashEquipmentFreeTextRow[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
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

export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key]);
    }
    return sorted;
  }
  return value;
}

export function buildVehicleListingContentHashPayload(
  input: VehicleListingContentHashInput,
): Record<string, unknown> {
  return sortJsonValue({
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
    portal_category: input.portal_category,
    export_assertions: sortJsonValue(input.export_assertions),
    equipment: sortedEquipment(input.equipment),
    equipment_free_text_lines: sortedEquipmentFreeText(
      input.equipment_free_text_lines,
    ),
    photos: sortedPhotos(input.photos),
    channels: sortedChannels(input.channels),
    vehicle: input.vehicle,
  }) as Record<string, unknown>;
}

export function computeVehicleListingContentSha256(
  input: VehicleListingContentHashInput,
): string {
  const payload = buildVehicleListingContentHashPayload(input);
  const canonical = JSON.stringify(payload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
