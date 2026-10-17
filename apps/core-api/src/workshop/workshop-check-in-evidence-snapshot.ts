import { WorkshopMediaPurpose, type Prisma } from '@prisma/client';
import { hashCanonicalJson } from '../invoices/invoice-snapshot-hash.js';
export const WORKSHOP_CHECK_IN_EVIDENCE_SCHEMA_VERSION = 3;

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
    mime_type: string;
    size_bytes: number;
    storage_bucket: string;
    storage_key: string;
    caption: string | null;
  }>;
  completed_at: string;
  completed_by_user_id: string | null;
  signature: {
    media_id: string;
    content_sha256: string;
    signed_by_name: string;
    signed_at: string;
    acknowledgement_version: string;
    acknowledgement_text: string;
    device_hash: string;
  };
  checklist: Array<{
    id: string;
    label_snapshot: string;
    passed: boolean | null;
    notes: string | null;
  }> | null;
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

type CheckInInspectionItemForEvidence = {
  id: string;
  label_snapshot: string;
  passed: boolean | null;
  notes: string | null;
  sort_order: number;
};

type CheckInMediaForEvidence = {
  id: string;
  purpose: WorkshopMediaPurpose;
  mime_type: string;
  size_bytes: number;
  storage_bucket: string;
  storage_key: string;
  caption: string | null;
};

export type CheckInSignatureEvidenceInput = {
  media_id: string;
  content_sha256: string;
  signed_by_name: string;
  signed_at: Date;
  acknowledgement_version: string;
  acknowledgement_text: string;
  device_hash: string;
};

/** Lexicographic order by UTF-16 code units (locale-independent). */
export function compareCheckInEvidenceStrings(
  left: string,
  right: string,
): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

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
        media_ids: [...new Set(mediaIds)].sort(compareCheckInEvidenceStrings),
      };
    })
    .filter((marker): marker is NonNullable<typeof marker> => marker !== null);

  return markers.sort((left, right) =>
    compareCheckInEvidenceStrings(left.id, right.id),
  );
}

export function normalizeCheckInWarningLights(values: string[]): string[] {
  return [...new Set(values)].sort(compareCheckInEvidenceStrings);
}

export function normalizeCheckInChecklistForEvidence(
  items: CheckInInspectionItemForEvidence[],
): WorkshopCheckInEvidenceSnapshot['checklist'] {
  if (items.length === 0) {
    return null;
  }
  return items
    .map((item) => ({
      id: item.id,
      label_snapshot: item.label_snapshot,
      passed: item.passed,
      notes: item.notes,
      sort_order: item.sort_order,
    }))
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }
      return compareCheckInEvidenceStrings(left.id, right.id);
    })
    .map(({ id, label_snapshot, passed, notes }) => ({
      id,
      label_snapshot,
      passed,
      notes,
    }));
}

export function normalizeCheckInMediaForEvidence(
  media: CheckInMediaForEvidence[],
): WorkshopCheckInEvidenceSnapshot['media'] {
  return media
    .filter((row) => row.purpose === WorkshopMediaPurpose.CHECK_IN)
    .map((row) => ({
      id: row.id,
      purpose: row.purpose,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      storage_bucket: row.storage_bucket,
      storage_key: row.storage_key,
      caption: row.caption,
    }))
    .sort((left, right) => compareCheckInEvidenceStrings(left.id, right.id));
}

export function normalizeCheckInSignatureForEvidence(
  input: CheckInSignatureEvidenceInput,
): WorkshopCheckInEvidenceSnapshot['signature'] {
  return {
    media_id: input.media_id,
    content_sha256: input.content_sha256,
    signed_by_name: input.signed_by_name,
    signed_at: input.signed_at.toISOString(),
    acknowledgement_version: input.acknowledgement_version,
    acknowledgement_text: input.acknowledgement_text,
    device_hash: input.device_hash,
  };
}

export function buildWorkshopCheckInEvidenceSnapshot(input: {
  row: CheckInRowForEvidence;
  media: CheckInMediaForEvidence[];
  checklistItems: CheckInInspectionItemForEvidence[];
  completedAt: Date;
  completedByUserId: string | null;
  signature: CheckInSignatureEvidenceInput;
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
    signature: normalizeCheckInSignatureForEvidence(input.signature),
    checklist: normalizeCheckInChecklistForEvidence(input.checklistItems),
  };
}

export function hashWorkshopCheckInEvidenceSnapshot(
  snapshot: WorkshopCheckInEvidenceSnapshot,
): string {
  return hashCanonicalJson(snapshot);
}
