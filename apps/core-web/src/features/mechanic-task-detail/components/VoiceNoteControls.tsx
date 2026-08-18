import { Loader2, Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { VoiceNoteState } from '../types'

type VoiceNoteControlsProps = {
  voiceNoteState: VoiceNoteState
  voiceDraftValue: string
  voiceNoteError: string
  disabled: boolean
  onStart: () => void
  onStop: () => void
  onDraftChange: (value: string) => void
  onAcceptDraft: () => void
  onDiscardDraft: () => void
}

function voiceNoteStatusMessage(state: VoiceNoteState, error: string) {
  if (state === 'unsupported') return 'Voice note recording is unavailable on this browser.'
  if (state === 'idle') {
    return 'Tap record to dictate a voice note. Review and edit the translated draft before acceptance.'
  }
  if (state === 'recording') return 'Recording…'
  if (state === 'draft-ready') return 'Draft ready. Review and edit before accepting into diagnostics.'
  if (state === 'accepted') return 'Draft accepted into diagnostics notes.'
  if (state === 'error') return error || 'Voice note failed. Please retry recording.'
  return null
}

export function VoiceNoteControls({
  voiceNoteState,
  voiceDraftValue,
  voiceNoteError,
  disabled,
  onStart,
  onStop,
  onDraftChange,
  onAcceptDraft,
  onDiscardDraft,
}: VoiceNoteControlsProps) {
  return (
    <>
      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50/70 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={voiceNoteState === 'recording' ? 'destructive' : 'outline'}
            className="min-h-[48px] gap-2 px-4"
            onClick={() => {
              if (voiceNoteState === 'recording') {
                onStop()
              } else {
                onStart()
              }
            }}
            disabled={disabled || voiceNoteState === 'processing' || voiceNoteState === 'unsupported'}
          >
            {voiceNoteState === 'recording' ? (
              <>
                <Square className="h-4 w-4" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                Record Voice Note
              </>
            )}
          </Button>
          {voiceNoteState === 'error' && (
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={onStart}
              disabled={disabled}
            >
              Retry recording
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {voiceNoteState === 'processing' ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Processing voice note…
            </span>
          ) : (
            voiceNoteStatusMessage(voiceNoteState, voiceNoteError)
          )}
        </p>
      </div>

      {voiceNoteState === 'draft-ready' && (
        <div className="mb-4 space-y-2 rounded-md border border-slate-200 p-3">
          <Label htmlFor="voice-note-draft">Voice-note draft</Label>
          <textarea
            id="voice-note-draft"
            value={voiceDraftValue}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={4}
            className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
            disabled={disabled}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDiscardDraft} disabled={disabled}>
              Discard Draft
            </Button>
            <Button
              type="button"
              onClick={onAcceptDraft}
              disabled={disabled || voiceDraftValue.trim().length === 0}
            >
              Accept Draft
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
