import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
  canSubmitFinding?: boolean
  submitFindingPending?: boolean
  onSubmitFinding?: () => void
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
  canSubmitFinding = false,
  submitFindingPending = false,
  onSubmitFinding,
}: DiagnosticsSectionProps) {
  const { t } = useTranslation('workshop')

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t('mechanic.taskDetail.diagnostics.title')}</CardTitle>
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
          placeholder={t('mechanic.taskDetail.diagnostics.placeholder')}
          rows={5}
          className="min-h-11 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-base md:text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
          disabled={disabled}
        />
        {onSubmitFinding && (
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              className="min-h-11"
              disabled={!canSubmitFinding || submitFindingPending}
              onClick={onSubmitFinding}
            >
              {submitFindingPending
                ? t('mechanic.taskDetail.diagnostics.sending')
                : t('mechanic.taskDetail.diagnostics.sendFinding')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
