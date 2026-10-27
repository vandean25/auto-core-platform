// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_IN_OFFLINE_DRAFT_TTL_MS } from './check-in-offline-constants'
import {
  buildMechanicNoteDraftKey,
  deleteMechanicNoteDraft,
  loadMechanicNoteDraft,
  purgeAllCheckInOfflineData,
  saveMechanicNoteDraft,
} from './check-in-offline-store'

const key = buildMechanicNoteDraftKey({ userId: 'u1', tenantId: 't1', siteId: 's1', taskId: 'task-1' })

describe('mechanic note drafts in the check-in offline store', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    await purgeAllCheckInOfflineData()
  })

  it('keeps the latest text per task, user, tenant and site', async () => {
    await saveMechanicNoteDraft(key, 'first')
    await saveMechanicNoteDraft(key, 'second')
    await saveMechanicNoteDraft(buildMechanicNoteDraftKey({ userId: 'u1', tenantId: 't1', siteId: 's1', taskId: 'task-2' }), 'other task')

    expect(await loadMechanicNoteDraft(key)).toBe('second')
    expect(await loadMechanicNoteDraft(buildMechanicNoteDraftKey({ userId: 'u2', tenantId: 't1', siteId: 's1', taskId: 'task-1' }))).toBeNull()
  })

  it('returns null after the draft is deleted', async () => {
    await saveMechanicNoteDraft(key, 'text')
    await deleteMechanicNoteDraft(key)

    expect(await loadMechanicNoteDraft(key)).toBeNull()
  })

  it('drops a draft older than the check-in draft time to live', async () => {
    await saveMechanicNoteDraft(key, 'stale')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + CHECK_IN_OFFLINE_DRAFT_TTL_MS + 1000)

    expect(await loadMechanicNoteDraft(key)).toBeNull()
    vi.useRealTimers()
    expect(await loadMechanicNoteDraft(key)).toBeNull()
  })

  it('is cleared together with the other offline data', async () => {
    await saveMechanicNoteDraft(key, 'text')
    await purgeAllCheckInOfflineData()

    expect(await loadMechanicNoteDraft(key)).toBeNull()
  })
})
