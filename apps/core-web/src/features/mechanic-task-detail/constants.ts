import type { PauseReason, SwitchReason } from './types'

export const DIAGNOSTICS_AUTOSAVE_DEBOUNCE_MS = 750
export const MEDIA_UPLOAD_DONE_RESET_MS = 4000

export const PAUSE_REASON_LABELS: Record<PauseReason, string> = {
  WAITING_PARTS: 'Waiting for Parts',
  WAITING_CUSTOMER: 'Waiting for Customer',
  OTHER: 'Other',
}

export const SWITCH_REASON_LABELS: Record<SwitchReason, string> = {
  WAITING_PARTS: 'Previous task — Waiting for Parts',
  WAITING_CUSTOMER: 'Previous task — Waiting for Customer',
  SWITCHED_TO_HIGHER_PRIORITY: 'Switched to Higher Priority',
}

export const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
])

export const PREFERRED_VOICE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

export const EMPTY_PART_REQUEST_FORM = { itemNo: '', description: '', qty: '1' }
