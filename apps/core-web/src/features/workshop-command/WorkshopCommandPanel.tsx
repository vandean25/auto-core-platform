import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import {
  WORKSHOP_COMMAND_MAX_TEXT_LENGTH,
  applyWorkshopCommandProposal,
  interpretWorkshopCommand,
  proposeWorkshopCommand,
  transcribeWorkshopAudio,
  type WorkshopCommandClarification,
  type WorkshopCommandIntent,
  type WorkshopCommandProposal,
  type WorkshopCommandProposalStatus,
  type WorkshopCommandResponse,
  type WorkshopCommandSelection,
  type WorkshopCommandSource,
} from '@/api/workshop-command'
import { WorkshopCommandPreview } from './WorkshopCommandPreview'
import { isCommandVoiceSupported, selectCommandRecorderMimeType } from './voice'

export interface WorkshopCommandPanelProps {
  onExit: () => void
  onOpenOrders?: () => void
}

type CommandError = {
  code?: string
  status?: number
  detail?: string
}

type ApiFailure = Error & {
  status?: number
  data?: { code?: string; message?: string | string[] }
}

const ERROR_CODES = new Set([
  'COMMAND_ID_REUSED',
  'SELECTION_NOT_OFFERED',
  'PLAN_STALE',
  'INTENT_INCOMPLETE',
  'SESSION_NOT_FOUND',
  'AUDIO_EMPTY',
  'AUDIO_TOO_LARGE',
  'AUDIO_UNSUPPORTED_TYPE',
  'TRANSCRIPT_EMPTY',
])

function newCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `command-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function toCommandError(error: unknown): CommandError {
  const failure = error as ApiFailure
  const data = failure?.data
  const code = typeof data?.code === 'string' && ERROR_CODES.has(data.code) ? data.code : undefined
  const message = Array.isArray(data?.message) ? data.message.join(' ') : data?.message
  return {
    ...(code ? { code } : {}),
    ...(typeof failure?.status === 'number' ? { status: failure.status } : {}),
    ...(typeof message === 'string' ? { detail: message } : {}),
  }
}

function withSelection(
  selections: WorkshopCommandSelection[],
  next: WorkshopCommandSelection,
): WorkshopCommandSelection[] {
  return [...selections.filter((entry) => entry.slot !== next.slot), next]
}

export function WorkshopCommandPanel({ onExit, onOpenOrders }: WorkshopCommandPanelProps) {
  const { t } = useTranslation('workshop')
  const [text, setText] = React.useState('')
  const [source, setSource] = React.useState<WorkshopCommandSource>('keyboard')
  const [commandId, setCommandId] = React.useState(newCommandId)
  const [selections, setSelections] = React.useState<WorkshopCommandSelection[]>([])
  const [result, setResult] = React.useState<WorkshopCommandResponse | null>(null)
  const [proposal, setProposal] = React.useState<WorkshopCommandProposal | null>(null)
  const [applied, setApplied] = React.useState<WorkshopCommandProposalStatus | null>(null)
  const [error, setError] = React.useState<CommandError | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [voiceState, setVoiceState] = React.useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [voiceError, setVoiceError] = React.useState<string | null>(null)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<BlobPart[]>([])
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  const voiceSupported = React.useMemo(() => isCommandVoiceSupported(), [])

  // The palette hands focus to its own input; in command mode the sentence is the entry point.
  React.useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  React.useEffect(() => stopStream, [stopStream])

  const resetReview = () => {
    setCommandId(newCommandId())
    setSelections([])
    setResult(null)
    setProposal(null)
    setApplied(null)
    setError(null)
  }

  const handleTextChange = (value: string) => {
    setText(value)
    setSource('keyboard')
    if (result || proposal || applied || error) {
      resetReview()
    }
  }

  const runInterpret = async (nextSelections: WorkshopCommandSelection[]) => {
    setBusy(true)
    setError(null)
    setProposal(null)
    setApplied(null)
    try {
      const response = await interpretWorkshopCommand({
        commandId,
        text: text.trim(),
        source,
        selections: nextSelections,
      })
      setSelections(nextSelections)
      setResult(response)
    } catch (failure) {
      setError(toCommandError(failure))
    } finally {
      setBusy(false)
    }
  }

  const handleReview = () => {
    if (!text.trim()) return
    void runInterpret(selections)
  }

  const handleChoose = (clarification: WorkshopCommandClarification, choiceId: string) => {
    const choice = clarification.choices.find((entry) => entry.choice_id === choiceId)
    if (!choice) return
    void runInterpret(withSelection(selections, { slot: choice.slot, value: choice.value }))
  }

  const handlePropose = async () => {
    if (!result || result.status !== 'ready') return
    setBusy(true)
    setError(null)
    try {
      const created = await proposeWorkshopCommand({ commandId, selections })
      setProposal(created)
    } catch (failure) {
      setError(toCommandError(failure))
    } finally {
      setBusy(false)
    }
  }

  const handleApplyProposal = async () => {
    if (!proposal) return
    setBusy(true)
    setError(null)
    try {
      const decided = await applyWorkshopCommandProposal(proposal.pending_action_id)
      setApplied(decided)
    } catch (failure) {
      setError(toCommandError(failure))
    } finally {
      setBusy(false)
    }
  }

  const startRecording = async () => {
    setVoiceError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = selectCommandRecorderMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        stopStream()
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        setVoiceState('transcribing')
        void transcribeWorkshopAudio(audio)
          .then((transcript) => {
            setText(transcript.transcript)
            setSource('voice_transcript')
            resetReview()
          })
          .catch((failure) => {
            const mapped = toCommandError(failure)
            setVoiceError(voiceErrorMessage(mapped, t))
          })
          .finally(() => setVoiceState('idle'))
      }
      recorderRef.current = recorder
      recorder.start()
      setVoiceState('recording')
    } catch {
      stopStream()
      setVoiceState('idle')
      setVoiceError(t('command.micDenied'))
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') {
      recorder.stop()
    }
    recorderRef.current = null
  }

  const handleVoiceButton = () => {
    if (voiceState === 'recording') {
      stopRecording()
      return
    }
    void startRecording()
  }

  const errorMessage = error ? errorText(error, t) : null
  const canReview = text.trim().length > 0 && !busy
  const showPreview = result?.status === 'ready'

  return (
    <div className="space-y-3 px-3 pb-3 pt-2">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{t('command.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('command.description')}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onExit} disabled={busy}>
          {t('command.backToSearch')}
        </Button>
      </header>

      <div className="space-y-2">
        <label htmlFor="workshop-command-text" className="text-sm font-medium">
          {t('command.sentenceLabel')}
        </label>
        <textarea
          id="workshop-command-text"
          ref={textareaRef}
          className="flex min-h-[88px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base md:text-sm"
          value={text}
          maxLength={WORKSHOP_COMMAND_MAX_TEXT_LENGTH}
          placeholder={t('command.sentencePlaceholder')}
          disabled={busy || voiceState === 'transcribing'}
          onChange={(event) => handleTextChange(event.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {t('command.charCount', {
              count: text.length,
              max: WORKSHOP_COMMAND_MAX_TEXT_LENGTH,
            })}
          </span>
          {source === 'voice_transcript' ? <span>{t('command.transcriptHint')}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleReview} disabled={!canReview}>
          {result ? t('command.rereview') : t('command.review')}
        </Button>
        {voiceSupported ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleVoiceButton}
            disabled={busy || voiceState === 'transcribing'}
          >
            {voiceState === 'recording'
              ? t('command.stopRecording')
              : voiceState === 'transcribing'
                ? t('command.transcribing')
                : t('command.record')}
          </Button>
        ) : (
          <span className="self-center text-xs text-muted-foreground">
            {t('command.micUnsupported')}
          </span>
        )}
        {result ? (
          <Button type="button" variant="ghost" onClick={resetReview} disabled={busy}>
            {t('command.editSentence')}
          </Button>
        ) : null}
      </div>

      {voiceError ? (
        <p role="alert" className="text-xs text-destructive">
          {voiceError}
        </p>
      ) : null}

      {errorMessage ? (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
        >
          <p>{errorMessage}</p>
          {error?.detail && error.code !== 'COMMAND_ID_REUSED' ? (
            <p className="text-muted-foreground">{error.detail}</p>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={resetReview}>
            {t('command.rereview')}
          </Button>
        </div>
      ) : null}

      {result?.status === 'clarification' ? (
        <ClarificationBlock
          clarification={result}
          busy={busy}
          onChoose={(choiceId) => handleChoose(result, choiceId)}
        />
      ) : null}

      {showPreview && result.status === 'ready' ? (
        <WorkshopCommandPreview
          intent={result as WorkshopCommandIntent}
          busy={busy}
          applyDisabled={Boolean(proposal)}
          onEditSentence={resetReview}
          onApply={() => void handlePropose()}
        />
      ) : null}

      {proposal && !applied ? (
        <section aria-labelledby="workshop-command-pending" className="space-y-1 rounded-md border p-2">
          <h3 id="workshop-command-pending" className="text-sm font-semibold">
            {t('command.pendingHeading')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('command.pendingHint', { id: proposal.pending_action_id })}
          </p>
          <p className="text-xs font-medium">{t('command.pendingNotApplied')}</p>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleApplyProposal()}
            disabled={busy}
          >
            {busy ? t('command.applying') : t('command.applyNow')}
          </Button>
        </section>
      ) : null}

      {applied ? (
        <section aria-labelledby="workshop-command-applied" className="space-y-2 rounded-md border p-2">
          <h3 id="workshop-command-applied" className="text-sm font-semibold">
            {t('command.appliedHeading')}
          </h3>
          <p className="text-xs">{t('command.appliedHint')}</p>
          {onOpenOrders ? (
            <Button type="button" size="sm" variant="outline" onClick={onOpenOrders}>
              {t('command.openOrders')}
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function ClarificationBlock({
  clarification,
  busy,
  onChoose,
}: {
  clarification: WorkshopCommandClarification
  busy: boolean
  onChoose: (choiceId: string) => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <section
      aria-labelledby="workshop-command-clarification"
      className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2"
    >
      <h3 id="workshop-command-clarification" className="text-sm font-semibold">
        {t('command.clarificationHeading')}
      </h3>
      <p className="text-sm">{clarification.prompt}</p>
      {clarification.choices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {clarification.choices.map((choice) => (
            <Button
              key={choice.choice_id}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onChoose(choice.choice_id)}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('command.clarificationNoChoices')}</p>
      )}
    </section>
  )
}

type Translate = TFunction<'workshop'>

function errorText(error: CommandError, t: Translate): string {
  switch (error.code) {
    case 'COMMAND_ID_REUSED':
      return t('command.errorCommandIdReused')
    case 'SELECTION_NOT_OFFERED':
      return t('command.errorSelectionNotOffered')
    case 'PLAN_STALE':
      return t('command.errorPlanStale')
    case 'INTENT_INCOMPLETE':
      return t('command.errorIntentIncomplete')
    case 'SESSION_NOT_FOUND':
      return t('command.errorSessionNotFound')
    default:
      break
  }
  if (error.status === 403) return t('command.errorForbidden')
  return t('command.errorGeneric')
}

function voiceErrorMessage(error: CommandError, t: Translate): string {
  if (error.code === 'TRANSCRIPT_EMPTY') return t('command.transcriptEmpty')
  if (error.status === 503) return t('command.sttNotConfigured')
  if (error.status === 502 || error.status === 500) return t('command.sttFailed')
  if (error.code?.startsWith('AUDIO_')) return t('command.sttFailed')
  return t('command.sttFailed')
}
