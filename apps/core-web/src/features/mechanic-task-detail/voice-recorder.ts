import { PREFERRED_VOICE_MIME_TYPES } from './constants'

export function selectVoiceRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined
  }
  return PREFERRED_VOICE_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}

export function isVoiceNoteSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}
