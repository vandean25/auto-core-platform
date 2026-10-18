import {
  listAllCheckInOfflineDrafts,
  listAllPendingCheckInCreates,
  listAllQueuedPhotos,
  type CheckInQueuedPhotoRecord,
} from './check-in-offline-store'

export type CheckInOfflineUnsyncedSummary = {
  dirtyDraftCount: number
  queuedPhotoCount: number
  pendingCreateCount: number
}

export function hasUnsyncedCheckInOfflineData(
  summary: CheckInOfflineUnsyncedSummary,
): boolean {
  return (
    summary.dirtyDraftCount > 0 ||
    summary.queuedPhotoCount > 0 ||
    summary.pendingCreateCount > 0
  )
}

export async function summarizeCheckInOfflineUnsynced(): Promise<CheckInOfflineUnsyncedSummary> {
  const [drafts, photos, pendingCreates] = await Promise.all([
    listAllCheckInOfflineDrafts(),
    listAllQueuedPhotos(),
    listAllPendingCheckInCreates(),
  ])

  const dirtyDraftCount = drafts.filter(
    (row) => row.dirty || row.pendingServerSync,
  ).length

  const queuedPhotoCount = photos.filter(
    (row: CheckInQueuedPhotoRecord) =>
      row.status === 'queued' ||
      row.status === 'uploading' ||
      row.status === 'failed',
  ).length

  return {
    dirtyDraftCount,
    queuedPhotoCount,
    pendingCreateCount: pendingCreates.length,
  }
}
