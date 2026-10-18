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

export async function loadCheckInOfflineDraft(
  scope: CheckInOfflineScope,
): Promise<CheckInOfflineDraftRecord | null> {
  const scopeKey = buildCheckInOfflineScopeKey(scope)
  const row = await withStore<DraftRow | undefined>(DRAFT_STORE, 'readonly', (store) =>
    store.get(scopeKey),
  )
  if (!row) {
    return null
  }
  if (Date.now() - row.lastLocalSavedAt > CHECK_IN_OFFLINE_DRAFT_TTL_MS) {
    await deleteCheckInOfflineDraft(scope)
    return null
  }
  return row
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
