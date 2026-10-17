import { WorkshopMediaPurpose } from '@prisma/client';
import {
  buildWorkshopCheckInEvidenceSnapshot,
  compareCheckInEvidenceStrings,
  hashWorkshopCheckInEvidenceSnapshot,
  normalizeCheckInDamageMarkers,
  normalizeCheckInWarningLights,
} from './workshop-check-in-evidence-snapshot.js';

const COMPLETED_AT = new Date('2026-10-17T12:00:00.000Z');

function sampleSignature() {
  return {
    media_id: 'sig-media-1',
    content_sha256: 'a'.repeat(64),
    signed_by_name: 'Signer Example',
    signed_at: COMPLETED_AT,
    acknowledgement_version: 'check-in-signature-v1',
    acknowledgement_text: 'acknowledgement text',
  };
}

function checkInMedia(
  overrides: Partial<{
    id: string;
    purpose: WorkshopMediaPurpose;
    mime_type: string;
    size_bytes: number;
    storage_bucket: string;
    storage_key: string;
    caption: string | null;
  }> = {},
) {
  return {
    id: 'media-1',
    purpose: WorkshopMediaPurpose.CHECK_IN,
    mime_type: 'image/jpeg',
    size_bytes: 1024,
    storage_bucket: 'workshop-media',
    storage_key: 'tenant/check-in/photo.jpg',
    caption: null,
    ...overrides,
  };
}

function baseRow() {
  return {
    id: '550e8400-e29b-41d4-a716-446655440011',
    workshop_order_id: '550e8400-e29b-41d4-a716-446655440010',
    condition_json: {
      schema_version: 1,
      tyre_season: 'WINTER',
      exterior_notes: 'note',
      interior_notes: '',
    },
    damage_markers_json: [
      {
        id: 'b-marker',
        zone_id: 'REAR_BUMPER',
        type: 'SCRATCH',
        note: 'scratch',
        media_ids: ['media-2', 'media-1'],
      },
      {
        id: 'a-marker',
        zone_id: 'FRONT_BUMPER',
        type: 'DENT',
        note: '',
        media_ids: [],
      },
    ],
    items_left: 'umbrella',
    key_count: 1,
    warning_lights: ['TPMS', 'ABS'],
    odometer: 125010,
    fuel_level: 38,
  };
}

describe('workshop check-in evidence snapshot', () => {
  it('normalizes marker and warning-light ordering deterministically', () => {
    expect(normalizeCheckInDamageMarkers(baseRow().damage_markers_json)).toEqual([
      {
        id: 'a-marker',
        zone_id: 'FRONT_BUMPER',
        type: 'DENT',
        note: '',
        media_ids: [],
      },
      {
        id: 'b-marker',
        zone_id: 'REAR_BUMPER',
        type: 'SCRATCH',
        note: 'scratch',
        media_ids: ['media-1', 'media-2'],
      },
    ]);
    expect(normalizeCheckInWarningLights(['TPMS', 'ABS', 'TPMS'])).toEqual([
      'ABS',
      'TPMS',
    ]);
  });

  it('sorts strings by UTF-16 code units regardless of locale', () => {
    const sorted = normalizeCheckInWarningLights(['ö', 'z']);
    expect(sorted).toEqual(['z', 'ö']);
    expect(compareCheckInEvidenceStrings('z', 'ö')).toBeLessThan(0);
    expect(compareCheckInEvidenceStrings('ö', 'z')).toBeGreaterThan(0);
  });

  it('hashes identical canonical content to the same digest', () => {
    const left = buildWorkshopCheckInEvidenceSnapshot({
      row: baseRow(),
      media: [
        checkInMedia({ id: 'media-2' }),
        checkInMedia({ id: 'media-1' }),
      ],
      checklistItems: [],
      completedAt: COMPLETED_AT,
      completedByUserId: 'user-1',
      signature: sampleSignature(),
    });
    const right = buildWorkshopCheckInEvidenceSnapshot({
      row: {
        ...baseRow(),
        warning_lights: ['ABS', 'TPMS'],
        damage_markers_json: [
          {
            id: 'b-marker',
            zone_id: 'REAR_BUMPER',
            type: 'SCRATCH',
            note: 'scratch',
            media_ids: ['media-1', 'media-2'],
          },
          {
            id: 'a-marker',
            zone_id: 'FRONT_BUMPER',
            type: 'DENT',
            note: '',
            media_ids: [],
          },
        ],
      },
      media: [checkInMedia({ id: 'media-1' }), checkInMedia({ id: 'media-2' })],
      checklistItems: [],
      completedAt: COMPLETED_AT,
      completedByUserId: 'user-1',
      signature: sampleSignature(),
    });

    expect(hashWorkshopCheckInEvidenceSnapshot(left)).toBe(
      hashWorkshopCheckInEvidenceSnapshot(right),
    );
  });

  it('changes the digest when evidence content changes', () => {
    const baseline = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: baseRow(),
        media: [],
        checklistItems: [],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
        signature: sampleSignature(),
      }),
    );
    const changedItems = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: { ...baseRow(), items_left: 'jacket' },
        media: [],
        checklistItems: [],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
        signature: sampleSignature(),
      }),
    );
    const changedMedia = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: baseRow(),
        media: [checkInMedia({ id: 'media-9' })],
        checklistItems: [],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
        signature: sampleSignature(),
      }),
    );
    const changedMediaCaption = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: baseRow(),
        media: [checkInMedia({ id: 'media-9', caption: 'rear scratch' })],
        checklistItems: [],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
        signature: sampleSignature(),
      }),
    );
    const changedChecklist = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: baseRow(),
        media: [],
        checklistItems: [
          {
            id: 'item-1',
            label_snapshot: 'Warndreieck',
            passed: true,
            notes: null,
            sort_order: 1,
          },
        ],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
        signature: sampleSignature(),
      }),
    );

    expect(changedItems).not.toBe(baseline);
    expect(changedMedia).not.toBe(baseline);
    expect(changedMediaCaption).not.toBe(changedMedia);
    expect(changedChecklist).not.toBe(baseline);
  });

  it('changes the digest when signature acknowledgement text changes', () => {
    const baseline = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: baseRow(),
        media: [],
        checklistItems: [],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
        signature: sampleSignature(),
      }),
    );
    const changedAck = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: baseRow(),
        media: [],
        checklistItems: [],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
        signature: {
          ...sampleSignature(),
          acknowledgement_text: 'different acknowledgement',
        },
      }),
    );
    expect(changedAck).not.toBe(baseline);
  });

  it('locks the v3 evidence digest for a minimal fixture', () => {
    const digest = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: baseRow(),
        media: [],
        checklistItems: [],
        completedAt: COMPLETED_AT,
        completedByUserId: null,
        signature: sampleSignature(),
      }),
    );
    expect(digest).toBe(
      '6d3fe06afc93932aae21fb79e64e264a756669c7c97b0dd9995d7b46b0fdf1fd',
    );
  });
});
