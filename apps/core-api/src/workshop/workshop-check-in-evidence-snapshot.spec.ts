import { WorkshopMediaPurpose } from '@prisma/client';
import {
  buildWorkshopCheckInEvidenceSnapshot,
  hashWorkshopCheckInEvidenceSnapshot,
  normalizeCheckInDamageMarkers,
  normalizeCheckInWarningLights,
} from './workshop-check-in-evidence-snapshot.js';

const COMPLETED_AT = new Date('2026-10-17T12:00:00.000Z');

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

  it('hashes identical canonical content to the same digest', () => {
    const left = buildWorkshopCheckInEvidenceSnapshot({
      row: baseRow(),
      media: [
        { id: 'media-2', purpose: WorkshopMediaPurpose.CHECK_IN },
        { id: 'media-1', purpose: WorkshopMediaPurpose.CHECK_IN },
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
      media: [{ id: 'media-1', purpose: WorkshopMediaPurpose.CHECK_IN }, { id: 'media-2', purpose: WorkshopMediaPurpose.CHECK_IN }],
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
        media: [{ id: 'media-9', purpose: WorkshopMediaPurpose.CHECK_IN }],
        completedAt: COMPLETED_AT,
        completedByUserId: 'user-1',
      }),
    );

    expect(changedItems).not.toBe(baseline);
    expect(changedMedia).not.toBe(baseline);
  });
});
