import { describe, expect, it } from 'vitest'
import type { WorkshopCheckIn } from '@/api/workshop-check-in'
import { buildUpdatePayload, draftFromCheckIn } from './check-in-draft'

describe('check-in draft helpers', () => {
  it('builds patch payload with expected revision', () => {
    const record: WorkshopCheckIn = {
      id: 'ci-1',
      workshop_order_id: 'order-1',
      status: 'DRAFT' as const,
      revision: 2,
      condition_json: {
        tyre_season: 'WINTER',
        exterior_notes: 'a',
        interior_notes: 'b',
      } as unknown as WorkshopCheckIn['condition_json'],
      damage_markers_json: [],
      items_left: 'umbrella',
      key_count: 1,
      warning_lights: ['ABS'],
      odometer: 12000,
      fuel_level: 55,
      inspection_id: null,
      content_sha256: null,
      completed_at: null,
      pdf_sha256: null,
      created_at: '2026-10-17T00:00:00.000Z',
      updated_at: '2026-10-17T00:00:00.000Z',
    }

    const draft = draftFromCheckIn(record)
    const payload = buildUpdatePayload(2, draft)

    expect(payload.expected_revision).toBe(2)
    expect(payload.odometer).toBe(12000)
    expect(payload.condition?.tyre_season).toBe('WINTER')
    expect(payload.items_left).toBe('umbrella')
  })
})
