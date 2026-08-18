import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SaveState, VoiceNoteState } from '../types'
import { SaveStateIndicator } from './SaveStateIndicator'
import { VoiceNoteControls } from './VoiceNoteControls'

type DiagnosticsSectionProps = {
  notesValue: string
  saveState: SaveState
  disabled: boolean
  onNotesChange: (value: string) => void
  voiceNoteState: VoiceNoteState
  voiceDraftValue: string
  voiceNoteError: string
  onStartVoiceNote: () => void
  onStopVoiceNote: () => void
  onVoiceDraftChange: (value: string) => void
  onAcceptVoiceDraft: () => void
  onDiscardVoiceDraft: () => void
}

export function DiagnosticsSection({
  notesValue,
  saveState,
  disabled,
  onNotesChange,
  voiceNoteState,
  voiceDraftValue,
  voiceNoteError,
  onStartVoiceNote,
  onStopVoiceNote,
  onVoiceDraftChange,
  onAcceptVoiceDraft,
  onDiscardVoiceDraft,
}: DiagnosticsSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Diagnostics &amp; Notes</CardTitle>
          <SaveStateIndicator state={saveState} />
        </div>
      </CardHeader>
      <CardContent>
        <VoiceNoteControls
          voiceNoteState={voiceNoteState}
          voiceDraftValue={voiceDraftValue}
          voiceNoteError={voiceNoteError}
          disabled={disabled}
          onStart={onStartVoiceNote}
          onStop={onStopVoiceNote}
          onDraftChange={onVoiceDraftChange}
          onAcceptDraft={onAcceptVoiceDraft}
          onDiscardDraft={onDiscardVoiceDraft}
        />
        <textarea
          value={notesValue}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="Record diagnostic findings, measurements, or notes here…"
          rows={5}
          className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
          disabled={disabled}
        />
      </CardContent>
    </Card>
  )
}
