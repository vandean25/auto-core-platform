import { useTranslation } from 'react-i18next'
import { Loader2, Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { TFunction } from 'i18next'
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

function voiceNoteStatusMessage(
  state: VoiceNoteState,
  error: string,
  t: TFunction<'workshop'>,
): string | null {
  if (state === 'unsupported') return t('mechanic.taskDetail.voiceNote.unsupported')
  if (state === 'idle') return t('mechanic.taskDetail.voiceNote.idleHint')
  if (state === 'recording') return t('mechanic.taskDetail.voiceNote.recording')
  if (state === 'draft-ready') return t('mechanic.taskDetail.voiceNote.draftReady')
  if (state === 'accepted') return t('mechanic.taskDetail.voiceNote.accepted')
  if (state === 'error') return error || t('mechanic.taskDetail.voiceNote.errorFallback')
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
  const { t } = useTranslation('workshop')

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
                {t('mechanic.taskDetail.voiceNote.stop')}
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                {t('mechanic.taskDetail.voiceNote.record')}
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
              {t('mechanic.taskDetail.voiceNote.retry')}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {voiceNoteState === 'processing' ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('mechanic.taskDetail.voiceNote.processing')}
            </span>
          ) : (
            voiceNoteStatusMessage(voiceNoteState, voiceNoteError, t)
          )}
        </p>
      </div>

      {voiceNoteState === 'draft-ready' && (
        <div className="mb-4 space-y-2 rounded-md border border-slate-200 p-3">
          <Label htmlFor="voice-note-draft">{t('mechanic.taskDetail.voiceNote.draftLabel')}</Label>
          <textarea
            id="voice-note-draft"
            value={voiceDraftValue}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={4}
            className="min-h-11 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-base md:text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
            disabled={disabled}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onDiscardDraft} disabled={disabled}>
              {t('mechanic.taskDetail.voiceNote.discardDraft')}
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={onAcceptDraft}
              disabled={disabled || voiceDraftValue.trim().length === 0}
            >
              {t('mechanic.taskDetail.voiceNote.acceptDraft')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
