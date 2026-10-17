import { WorkshopMediaPurpose } from '@prisma/client';
import {
  buildWorkshopCheckInEvidenceSnapshot,
  compareCheckInEvidenceStrings,
  hashWorkshopCheckInEvidenceSnapshot,
  normalizeCheckInDamageMarkers,
  normalizeCheckInWarningLights,
} from './workshop-check-in-evidence-snapshot.js';

const COMPLETED_AT = new Date('2026-10-17T12:00:00.000Z');

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
        zone_id: 'rear_bumper',
        type: 'SCRATCH',
        note: 'scratch',
        media_ids: ['media-2', 'media-1'],
      },
      {
        id: 'a-marker',
        zone_id: 'front_bumper',
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
        zone_id: 'front_bumper',
        type: 'DENT',
        note: '',
        media_ids: [],
      },
      {
        id: 'b-marker',
        zone_id: 'rear_bumper',
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
      completedAt: COMPLETED_AT,
      completedByUserId: 'user-1',
    });
    const right = buildWorkshopCheckInEvidenceSnapshot({
      row: {
        ...baseRow(),
        warning_lights: ['ABS', 'TPMS'],
        damage_markers_json: [
          {
            id: 'b-marker',
            zone_id: 'rear_bumper',
            type: 'SCRATCH',
            note: 'scratch',
            media_ids: ['media-1', 'media-2'],
          },
          {
            id: 'a-marker',
            zone_id: 'front_bumper',
            type: 'DENT',
            note: '',
            media_ids: [],
          },
        ],
      },
      media: [checkInMedia({ id: 'media-1' }), checkInMedia({ id: 'media-2' })],
      completedAt: COMPLETED_AT,
      completedByUserId: 'user-1',
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
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
      }),
    );
    const changedItems = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: { ...baseRow(), items_left: 'jacket' },
        media: [],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
      }),
    );
    const changedMedia = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: baseRow(),
        media: [checkInMedia({ id: 'media-9' })],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
      }),
    );
    const changedMediaCaption = hashWorkshopCheckInEvidenceSnapshot(
      buildWorkshopCheckInEvidenceSnapshot({
        row: baseRow(),
        media: [checkInMedia({ id: 'media-9', caption: 'rear scratch' })],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
      }),
    );

    expect(changedItems).not.toBe(baseline);
    expect(changedMedia).not.toBe(baseline);
    expect(changedMediaCaption).not.toBe(changedMedia);
  });
});
