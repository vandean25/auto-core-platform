import type { PauseTaskPayload, SwitchTaskPayload } from '@/api/mechanic'

export type PauseReason = PauseTaskPayload['pauseReason']
export type SwitchReason = SwitchTaskPayload['previousPauseReason']
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
export type UploadState = 'idle' | 'uploading' | 'done' | 'error'
export type VoiceNoteState =
  | 'idle'
  | 'unsupported'
  | 'recording'
  | 'processing'
  | 'draft-ready'
  | 'accepted'
  | 'error'

export type PartRequestForm = {
  itemNo: string
  description: string
  qty: string
}
