import type { Prisma, WorkshopMediaPurpose } from '@prisma/client';
import { hashCanonicalJson } from '../invoices/invoice-snapshot-hash.js';
import { WORKSHOP_CHECK_IN_MEDIA_PURPOSES } from './workshop-media-purpose.helpers.js';

export const WORKSHOP_CHECK_IN_EVIDENCE_SCHEMA_VERSION = 1;

export type WorkshopCheckInEvidenceSnapshot = {
  schema_version: typeof WORKSHOP_CHECK_IN_EVIDENCE_SCHEMA_VERSION;
  check_in_id: string;
  workshop_order_id: string;
  condition: {
    schema_version: number;
    tyre_season: string;
    exterior_notes: string;
    interior_notes: string;
  };
  damage_markers: Array<{
    id: string;
    zone_id: string;
    type: string;
    note: string;
    media_ids: string[];
  }>;
  items_left: string;
  key_count: number;
  warning_lights: string[];
  odometer: number;
  fuel_level: number;
  media: Array<{
    id: string;
    purpose: WorkshopMediaPurpose;
    content_sha256: string | null;
  }>;
  completed_at: string;
  completed_by_user_id: string | null;
};

type CheckInRowForEvidence = {
  id: string;
  workshop_order_id: string;
  condition_json: Prisma.JsonValue;
  damage_markers_json: Prisma.JsonValue;
  items_left: string;
  key_count: number;
  warning_lights: string[];
  odometer: number;
  fuel_level: number;
};

type CheckInMediaForEvidence = {
  id: string;
  purpose: WorkshopMediaPurpose;
};

export function normalizeCheckInCondition(
  conditionJson: Prisma.JsonValue,
): WorkshopCheckInEvidenceSnapshot['condition'] {
  const raw =
    conditionJson &&
    typeof conditionJson === 'object' &&
    !Array.isArray(conditionJson)
      ? (conditionJson as Record<string, unknown>)
      : {};
  return {
    schema_version:
      typeof raw.schema_version === 'number' ? raw.schema_version : 1,
    tyre_season:
      typeof raw.tyre_season === 'string' ? raw.tyre_season : 'UNKNOWN',
    exterior_notes:
      typeof raw.exterior_notes === 'string' ? raw.exterior_notes : '',
    interior_notes:
      typeof raw.interior_notes === 'string' ? raw.interior_notes : '',
  };
}

export function normalizeCheckInDamageMarkers(
  damageMarkersJson: Prisma.JsonValue,
): WorkshopCheckInEvidenceSnapshot['damage_markers'] {
  if (!Array.isArray(damageMarkersJson)) {
    return [];
  }

  const markers = damageMarkersJson
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }
      const marker = entry as Record<string, unknown>;
      const id = typeof marker.id === 'string' ? marker.id : '';
      const zoneId = typeof marker.zone_id === 'string' ? marker.zone_id : '';
      const type = typeof marker.type === 'string' ? marker.type : '';
      const note = typeof marker.note === 'string' ? marker.note : '';
      const mediaIds = Array.isArray(marker.media_ids)
        ? marker.media_ids.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      if (!id || !zoneId || !type) {
        return null;
      }
      return {
        id,
        zone_id: zoneId,
        type,
        note,
        media_ids: [...new Set(mediaIds)].sort(),
      };
    })
    .filter((marker): marker is NonNullable<typeof marker> => marker !== null);

  return markers.sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeCheckInWarningLights(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normalizeCheckInMediaForEvidence(
  media: CheckInMediaForEvidence[],
): WorkshopCheckInEvidenceSnapshot['media'] {
  return media
    .filter((row) => WORKSHOP_CHECK_IN_MEDIA_PURPOSES.has(row.purpose))
    .map((row) => ({
      id: row.id,
      purpose: row.purpose,
      content_sha256: null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function buildWorkshopCheckInEvidenceSnapshot(input: {
  row: CheckInRowForEvidence;
  media: CheckInMediaForEvidence[];
  completedAt: Date;
  completedByUserId: string | null;
}): WorkshopCheckInEvidenceSnapshot {
  return {
    schema_version: WORKSHOP_CHECK_IN_EVIDENCE_SCHEMA_VERSION,
    check_in_id: input.row.id,
    workshop_order_id: input.row.workshop_order_id,
    condition: normalizeCheckInCondition(input.row.condition_json),
    damage_markers: normalizeCheckInDamageMarkers(
      input.row.damage_markers_json,
    ),
    items_left: input.row.items_left,
    key_count: input.row.key_count,
    warning_lights: normalizeCheckInWarningLights(input.row.warning_lights),
    odometer: input.row.odometer,
    fuel_level: input.row.fuel_level,
    media: normalizeCheckInMediaForEvidence(input.media),
    completed_at: input.completedAt.toISOString(),
    completed_by_user_id: input.completedByUserId,
  };
}

export function hashWorkshopCheckInEvidenceSnapshot(
  snapshot: WorkshopCheckInEvidenceSnapshot,
): string {
  return hashCanonicalJson(snapshot);
}
