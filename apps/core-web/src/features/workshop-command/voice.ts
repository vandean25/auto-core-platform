/**
 * Browser voice capture for the reviewed command mode. Mirrors the mechanic
 * voice note preferences, but stays a local helper so the command surface has
 * no dependency on the mechanic feature.
 */
export const PREFERRED_COMMAND_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const

export function isCommandVoiceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

export function selectCommandRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined
  }
  return PREFERRED_COMMAND_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}
