// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_IN_OFFLINE_DB_NAME, CHECK_IN_OFFLINE_DRAFT_TTL_MS } from './check-in-offline-constants'
import {
  hasUnsyncedCheckInOfflineData,
  summarizeCheckInOfflineUnsynced,
} from './check-in-offline-unsynced'
import {
  purgeAllCheckInOfflineData,
  saveCheckInOfflineDraft,
  saveMechanicNoteDraft,
  upsertQueuedPhoto,
} from './check-in-offline-store'
import type { CheckInOfflineScope } from './check-in-offline-scope'
import type { CheckInDraftSnapshot } from './check-in-draft'

const scope: CheckInOfflineScope = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  orderId: 'order-1',
  checkInId: 'check-in-1',
}

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

describe('check-in-offline-unsynced', () => {
  beforeEach(async () => {
    await purgeAllCheckInOfflineData()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(CHECK_IN_OFFLINE_DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(request.error ?? new Error('deleteDatabase failed'))
    })
  })

  it('detects dirty drafts and queued photos from IndexedDB', async () => {
    await saveCheckInOfflineDraft({
      scope,
      serverBaseRevision: 1,
      draft: draftSnapshot,
      dirty: true,
      pendingServerSync: true,
      pendingCreate: false,
    })
    await upsertQueuedPhoto({
      clientUploadId: 'photo-1',
      scopeKey: 'user-1/tenant-1/site-1/order-1/check-in-1',
      orderId: 'order-1',
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      blob: new Blob(['a']),
      status: 'queued',
      attempts: 0,
      nextRetryAt: null,
      createdAt: Date.now(),
      lastErrorCode: null,
    })

    const summary = await summarizeCheckInOfflineUnsynced()
    expect(hasUnsyncedCheckInOfflineData(summary)).toBe(true)
    expect(summary.dirtyDraftCount).toBe(1)
    expect(summary.queuedPhotoCount).toBe(1)
  })

  it('counts unsynced mechanic task notes so sign-out and tenant switch warn before deleting them', async () => {
    await saveMechanicNoteDraft('user-1/tenant-1/site-1/task/task-1', 'Brake line leaks', 'server notes')

    const summary = await summarizeCheckInOfflineUnsynced()

    expect(summary.mechanicNoteDraftCount).toBe(1)
    expect(hasUnsyncedCheckInOfflineData(summary)).toBe(true)
  })

  it('does not warn about mechanic notes that are older than the draft time to live', async () => {
    await saveMechanicNoteDraft('user-1/tenant-1/site-1/task/task-1', 'Forgotten', 'server notes')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + CHECK_IN_OFFLINE_DRAFT_TTL_MS + 1000)

    const summary = await summarizeCheckInOfflineUnsynced()
    vi.useRealTimers()

    expect(summary.mechanicNoteDraftCount).toBe(0)
    expect(hasUnsyncedCheckInOfflineData(summary)).toBe(false)
  })
})
