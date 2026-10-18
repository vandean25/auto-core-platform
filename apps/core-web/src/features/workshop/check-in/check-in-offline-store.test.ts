import { describe, expect, it } from 'vitest'
import { CHECK_IN_OFFLINE_DRAFT_TTL_MS } from './check-in-offline-constants'
import {
  isCheckInOfflineDraftExpired,
  type CheckInOfflineDraftRecord,
} from './check-in-offline-store'
import type { CheckInDraftSnapshot } from './check-in-draft'

const draftSnapshot: CheckInDraftSnapshot = {
  odometer: 1,
  fuel_level: 50,
  items_left: '',
  key_count: 0,
  warning_lights: [],
  condition: {
    tyre_season: 'UNKNOWN',
    exterior_notes: '',
    interior_notes: '',
  },
  damage_markers: [],
}

function makeRecord(lastLocalSavedAt: number): CheckInOfflineDraftRecord {
  return {
    scopeKey: 'scope',
    scope: {
      userId: 'u',
      tenantId: 't',
      siteId: 's',
      orderId: 'o',
      checkInId: 'c',
    },
    serverBaseRevision: 1,
    draft: draftSnapshot,
    dirty: true,
    pendingServerSync: true,
    lastLocalSavedAt,
    pendingCreate: false,
  }
}

describe('check-in-offline-store expiry', () => {
  it('flags drafts older than 24h without implying automatic deletion', () => {
    const expired = makeRecord(Date.now() - CHECK_IN_OFFLINE_DRAFT_TTL_MS - 1)
    const fresh = makeRecord(Date.now())
    expect(isCheckInOfflineDraftExpired(expired)).toBe(true)
    expect(isCheckInOfflineDraftExpired(fresh)).toBe(false)
  })
})
