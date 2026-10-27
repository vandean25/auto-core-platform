import type { CheckInDraftSnapshot } from './check-in-draft'
import {
  CHECK_IN_OFFLINE_DB_NAME,
  CHECK_IN_OFFLINE_DB_VERSION,
  CHECK_IN_OFFLINE_DRAFT_TTL_MS,
} from './check-in-offline-constants'
import {
  buildCheckInOfflineScopeKey,
  type CheckInOfflineScope,
} from './check-in-offline-scope'

const DRAFT_STORE = 'drafts'
const PHOTO_STORE = 'photoQueue'
const PENDING_CREATE_STORE = 'pendingCreates'
const MECHANIC_NOTE_DRAFT_STORE = 'mechanicNoteDrafts'

export type CheckInPendingCreateRecord = {
  orderScopeKey: string
  userId: string
  tenantId: string
  siteId: string
  orderId: string
  checkInId: string
  createdAt: number
}

export type CheckInOfflineDraftRecord = {
  scopeKey: string
  scope: CheckInOfflineScope
  serverBaseRevision: number
  draft: CheckInDraftSnapshot
  dirty: boolean
  pendingServerSync: boolean
  lastLocalSavedAt: number
  pendingCreate: boolean
}

/** Unsynced mechanic notes of one task, kept in the same offline database as the check-in drafts. */
export type MechanicNoteDraftRecord = {
  scopeKey: string
  text: string
  /** The server notes the draft was typed on top of; the draft is only restored while the server still has them. */
  baseNotes: string
  lastLocalSavedAt: number
}

export type CheckInQueuedPhotoStatus = 'queued' | 'uploading' | 'failed'

export type CheckInQueuedPhotoRecord = {
  clientUploadId: string
  scopeKey: string
  orderId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  blob: Blob
  status: CheckInQueuedPhotoStatus
  attempts: number
  nextRetryAt: number | null
  createdAt: number
  lastErrorCode: string | null
}

type DraftRow = CheckInOfflineDraftRecord
type PhotoRow = CheckInQueuedPhotoRecord

function openCheckInOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      CHECK_IN_OFFLINE_DB_NAME,
      CHECK_IN_OFFLINE_DB_VERSION,
    )
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: 'scopeKey' })
      }
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        const store = db.createObjectStore(PHOTO_STORE, {
          keyPath: 'clientUploadId',
        })
        store.createIndex('scopeKey', 'scopeKey', { unique: false })
      }
      if (!db.objectStoreNames.contains(PENDING_CREATE_STORE)) {
        db.createObjectStore(PENDING_CREATE_STORE, { keyPath: 'orderScopeKey' })
      }
      if (!db.objectStoreNames.contains(MECHANIC_NOTE_DRAFT_STORE)) {
        db.createObjectStore(MECHANIC_NOTE_DRAFT_STORE, { keyPath: 'scopeKey' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openCheckInOfflineDb()
  try {
    const tx = db.transaction(storeName, mode)
    const result = await requestToPromise(run(tx.objectStore(storeName)))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () =>
        reject(tx.error ?? new Error('IndexedDB transaction failed'))
    })
    return result
  } finally {
    db.close()
  }
}

export async function saveCheckInOfflineDraft(
  record: Omit<CheckInOfflineDraftRecord, 'scopeKey' | 'lastLocalSavedAt'> & {
    lastLocalSavedAt?: number
  },
): Promise<void> {
  const scopeKey = buildCheckInOfflineScopeKey(record.scope)
  const row: DraftRow = {
    ...record,
    scopeKey,
    lastLocalSavedAt: record.lastLocalSavedAt ?? Date.now(),
  }
  await withStore(DRAFT_STORE, 'readwrite', (store) => store.put(row))
}

export function isCheckInOfflineDraftExpired(
  record: CheckInOfflineDraftRecord,
): boolean {
  return Date.now() - record.lastLocalSavedAt > CHECK_IN_OFFLINE_DRAFT_TTL_MS
}

export async function loadCheckInOfflineDraft(
  scope: CheckInOfflineScope,
): Promise<CheckInOfflineDraftRecord | null> {
  const scopeKey = buildCheckInOfflineScopeKey(scope)
  const row = await withStore<DraftRow | undefined>(DRAFT_STORE, 'readonly', (store) =>
    store.get(scopeKey),
  )
  return row ?? null
}

export async function deleteCheckInOfflineDraft(
  scope: CheckInOfflineScope,
): Promise<void> {
  const scopeKey = buildCheckInOfflineScopeKey(scope)
  await withStore(DRAFT_STORE, 'readwrite', (store) => store.delete(scopeKey))
}

export async function listQueuedPhotosForScope(
  scope: CheckInOfflineScope,
): Promise<CheckInQueuedPhotoRecord[]> {
  const scopeKey = buildCheckInOfflineScopeKey(scope)
  const db = await openCheckInOfflineDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly')
    const index = tx.objectStore(PHOTO_STORE).index('scopeKey')
    const request = index.getAll(scopeKey)
    request.onsuccess = () => {
      db.close()
      resolve((request.result as PhotoRow[]) ?? [])
    }
    request.onerror = () => {
      db.close()
      reject(request.error ?? new Error('Failed to list queued photos'))
    }
  })
}

export async function listAllQueuedPhotos(): Promise<CheckInQueuedPhotoRecord[]> {
  const db = await openCheckInOfflineDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly')
    const request = tx.objectStore(PHOTO_STORE).getAll()
    request.onsuccess = () => {
      db.close()
      resolve((request.result as PhotoRow[]) ?? [])
    }
    request.onerror = () => {
      db.close()
      reject(request.error ?? new Error('Failed to list queued photos'))
    }
  })
}

export async function upsertQueuedPhoto(
  record: CheckInQueuedPhotoRecord,
): Promise<void> {
  await withStore(PHOTO_STORE, 'readwrite', (store) => store.put(record))
}

export async function deleteQueuedPhoto(clientUploadId: string): Promise<void> {
  await withStore(PHOTO_STORE, 'readwrite', (store) =>
    store.delete(clientUploadId),
  )
}

export async function clearQueuedPhotosForScope(
  scope: CheckInOfflineScope,
): Promise<void> {
  const photos = await listQueuedPhotosForScope(scope)
  await Promise.all(photos.map((photo) => deleteQueuedPhoto(photo.clientUploadId)))
}

export async function sumQueuedPhotoBytes(
  photos: CheckInQueuedPhotoRecord[],
): Promise<number> {
  return photos.reduce((sum, photo) => sum + photo.sizeBytes, 0)
}

export function buildOrderOfflineScopeKey(input: {
  userId: string
  tenantId: string
  siteId: string
  orderId: string
}): string {
  return [input.userId, input.tenantId, input.siteId, input.orderId].join('/')
}

export async function savePendingCheckInCreate(
  record: CheckInPendingCreateRecord,
): Promise<void> {
  await withStore(PENDING_CREATE_STORE, 'readwrite', (store) => store.put(record))
}

export async function loadPendingCheckInCreate(
  orderScopeKey: string,
): Promise<CheckInPendingCreateRecord | null> {
  const row = await withStore<CheckInPendingCreateRecord | undefined>(
    PENDING_CREATE_STORE,
    'readonly',
    (store) => store.get(orderScopeKey),
  )
  return row ?? null
}

export async function clearPendingCheckInCreate(
  orderScopeKey: string,
): Promise<void> {
  await withStore(PENDING_CREATE_STORE, 'readwrite', (store) =>
    store.delete(orderScopeKey),
  )
}

/** On load, every `uploading` row is abandoned (no in-flight pass survives a fresh session). */
export async function reconcileStaleUploadingPhotos(
  scope: CheckInOfflineScope,
): Promise<void> {
  const photos = await listQueuedPhotosForScope(scope)
  await Promise.all(
    photos
      .filter((photo) => photo.status === 'uploading')
      .map((photo) =>
        upsertQueuedPhoto({
          ...photo,
          status: 'queued',
        }),
      ),
  )
}

export async function clearPhotoQueueRetryDelays(
  scope: CheckInOfflineScope,
  preserveInFlightClientUploadIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const photos = await listQueuedPhotosForScope(scope)
  await Promise.all(
    photos
      .filter((photo) => {
        if (photo.status === 'failed' || photo.status === 'queued') {
          return true
        }
        if (
          photo.status === 'uploading' &&
          !preserveInFlightClientUploadIds.has(photo.clientUploadId)
        ) {
          return true
        }
        return false
      })
      .map((photo) =>
        upsertQueuedPhoto({
          ...photo,
          status: 'queued',
          nextRetryAt: null,
        }),
      ),
  )
}

async function clearObjectStore(storeName: string): Promise<void> {
  const db = await openCheckInOfflineDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).clear()
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB clear failed'))
    }
  })
}

/** Removes local check-in drafts, queued photo bytes, and pending create markers. */
export async function purgeAllCheckInOfflineData(): Promise<void> {
  await clearObjectStore(DRAFT_STORE)
  await clearObjectStore(PHOTO_STORE)
  await clearObjectStore(PENDING_CREATE_STORE)
  await clearObjectStore(MECHANIC_NOTE_DRAFT_STORE)
}

export async function listAllCheckInOfflineDrafts(): Promise<
  CheckInOfflineDraftRecord[]
> {
  const rows = await withStore<DraftRow[]>(DRAFT_STORE, 'readonly', (store) =>
    store.getAll(),
  )
  return rows ?? []
}

export async function listAllPendingCheckInCreates(): Promise<
  CheckInPendingCreateRecord[]
> {
  const rows = await withStore<CheckInPendingCreateRecord[]>(
    PENDING_CREATE_STORE,
    'readonly',
    (store) => store.getAll(),
  )
  return rows ?? []
}

export function buildMechanicNoteDraftKey(input: {
  userId: string
  tenantId: string
  siteId: string
  taskId: string
}): string {
  return [input.userId, input.tenantId, input.siteId, 'task', input.taskId].join('/')
}

export async function saveMechanicNoteDraft(scopeKey: string, text: string, baseNotes: string): Promise<void> {
  const row: MechanicNoteDraftRecord = { scopeKey, text, baseNotes, lastLocalSavedAt: Date.now() }
  await withStore(MECHANIC_NOTE_DRAFT_STORE, 'readwrite', (store) => store.put(row))
}

/** The draft, or null when there is none or it is older than the check-in draft TTL (an expired one is dropped). */
export async function loadMechanicNoteDraft(scopeKey: string): Promise<MechanicNoteDraftRecord | null> {
  const row = await withStore<MechanicNoteDraftRecord | undefined>(
    MECHANIC_NOTE_DRAFT_STORE,
    'readonly',
    (store) => store.get(scopeKey),
  )
  if (!row) return null
  if (Date.now() - row.lastLocalSavedAt > CHECK_IN_OFFLINE_DRAFT_TTL_MS) {
    await deleteMechanicNoteDraft(scopeKey)
    return null
  }
  return row
}

export async function deleteMechanicNoteDraft(scopeKey: string): Promise<void> {
  await withStore(MECHANIC_NOTE_DRAFT_STORE, 'readwrite', (store) => store.delete(scopeKey))
}

/** Drafts that can still be restored: rows older than the check-in draft TTL do not count. */
export async function countMechanicNoteDrafts(): Promise<number> {
  const rows = await withStore<MechanicNoteDraftRecord[]>(MECHANIC_NOTE_DRAFT_STORE, 'readonly', (store) => store.getAll())
  return rows.filter((row) => Date.now() - row.lastLocalSavedAt <= CHECK_IN_OFFLINE_DRAFT_TTL_MS).length
}
