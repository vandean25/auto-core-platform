// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_IN_OFFLINE_DB_NAME, CHECK_IN_OFFLINE_DRAFT_TTL_MS } from './check-in-offline-constants'
import {
  buildMechanicNoteDraftKey,
  countMechanicNoteDrafts,
  deleteMechanicNoteDraft,
  listAllPendingCheckInCreates,
  loadMechanicNoteDraft,
  purgeAllCheckInOfflineData,
  saveMechanicNoteDraft,
} from './check-in-offline-store'

const key = buildMechanicNoteDraftKey({ userId: 'u1', tenantId: 't1', siteId: 's1', taskId: 'task-1' })

function deleteDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CHECK_IN_OFFLINE_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

describe('mechanic note drafts in the check-in offline store', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    await purgeAllCheckInOfflineData()
  })

  it('keeps the latest text and its server base per task, user, tenant and site', async () => {
    await saveMechanicNoteDraft(key, 'first', 'server')
    await saveMechanicNoteDraft(key, 'second', 'server')
    await saveMechanicNoteDraft(buildMechanicNoteDraftKey({ userId: 'u1', tenantId: 't1', siteId: 's1', taskId: 'task-2' }), 'other task', '')

    expect(await loadMechanicNoteDraft(key)).toMatchObject({ text: 'second', baseNotes: 'server' })
    expect(await loadMechanicNoteDraft(buildMechanicNoteDraftKey({ userId: 'u2', tenantId: 't1', siteId: 's1', taskId: 'task-1' }))).toBeNull()
    expect(await countMechanicNoteDrafts()).toBe(2)
  })

  it('returns null after the draft is deleted', async () => {
    await saveMechanicNoteDraft(key, 'text', '')
    await deleteMechanicNoteDraft(key)

    expect(await loadMechanicNoteDraft(key)).toBeNull()
  })

  it('drops a draft older than the check-in draft time to live', async () => {
    await saveMechanicNoteDraft(key, 'stale', '')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + CHECK_IN_OFFLINE_DRAFT_TTL_MS + 1000)

    expect(await loadMechanicNoteDraft(key)).toBeNull()
    vi.useRealTimers()
    expect(await loadMechanicNoteDraft(key)).toBeNull()
  })

  it('is cleared together with the other offline data', async () => {
    await saveMechanicNoteDraft(key, 'text', '')
    await purgeAllCheckInOfflineData()

    expect(await loadMechanicNoteDraft(key)).toBeNull()
  })

  it('upgrades a version 2 database without losing its data', async () => {
    await deleteDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(CHECK_IN_OFFLINE_DB_NAME, 2)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('drafts', { keyPath: 'scopeKey' })
        db.createObjectStore('photoQueue', { keyPath: 'clientUploadId' }).createIndex('scopeKey', 'scopeKey')
        db.createObjectStore('pendingCreates', { keyPath: 'orderScopeKey' }).put({ orderScopeKey: 'o1', userId: 'u1' })
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })

    await saveMechanicNoteDraft(key, 'after upgrade', 'server')

    expect(await loadMechanicNoteDraft(key)).toMatchObject({ text: 'after upgrade' })
    expect(await listAllPendingCheckInCreates()).toHaveLength(1)
  })
})
