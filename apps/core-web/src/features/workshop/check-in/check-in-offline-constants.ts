/** Limits from docs/internal/02-Feature-Specs/Workshop/tablet-check-in.md (Offline policy). */
export const CHECK_IN_OFFLINE_MAX_QUEUED_PHOTOS = 20
export const CHECK_IN_OFFLINE_MAX_PHOTO_BYTES = 10 * 1024 * 1024
export const CHECK_IN_OFFLINE_MAX_TOTAL_QUEUED_BYTES = 100 * 1024 * 1024
export const CHECK_IN_OFFLINE_MAX_ORDER_QUEUED_BYTES = 50 * 1024 * 1024
export const CHECK_IN_OFFLINE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export const CHECK_IN_OFFLINE_UPLOAD_RETRY_DELAYS_MS = [1000, 4000] as const

export const CHECK_IN_OFFLINE_DB_NAME = 'auto-core-check-in-offline'
// 3: adds the mechanic notes draft store (AUT-739).
export const CHECK_IN_OFFLINE_DB_VERSION = 3
