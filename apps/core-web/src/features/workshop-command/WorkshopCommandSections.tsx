import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import {
  WORKSHOP_COMMAND_MAX_TEXT_LENGTH,
  type WorkshopCommandClarification,
  type WorkshopCommandProposal,
  type WorkshopCommandSource,
} from '@/api/workshop-command'
import type { CommandError } from './command-error'
import type { CommandVoiceState } from './useWorkshopCommandVoice'

export function CommandHeader({
  busy,
  onExit,
}: {
  busy: boolean
  onExit: () => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t('command.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('command.description')}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onExit} disabled={busy}>
        {t('command.backToSearch')}
      </Button>
    </header>
  )
}

export function CommandSentenceField({
  textareaRef,
  text,
  source,
  disabled,
  onChange,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  text: string
  source: WorkshopCommandSource
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('workshop')
  return (
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
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
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
  )
}

function voiceButtonLabel(
  state: CommandVoiceState,
  t: TFunction<'workshop'>,
): string {
  if (state === 'recording') return t('command.stopRecording')
  if (state === 'transcribing') return t('command.transcribing')
  return t('command.record')
}

export function CommandToolbar({
  busy,
  hasResult,
  canReview,
  voiceSupported,
  voiceState,
  onReview,
  onVoice,
  onReset,
}: {
  busy: boolean
  hasResult: boolean
  canReview: boolean
  voiceSupported: boolean
  voiceState: CommandVoiceState
  onReview: () => void
  onVoice: () => void
  onReset: () => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={onReview} disabled={!canReview}>
        {hasResult ? t('command.rereview') : t('command.review')}
      </Button>
      {voiceSupported ? (
        <Button
          type="button"
          variant="outline"
          onClick={onVoice}
          disabled={busy || voiceState === 'transcribing'}
        >
          {voiceButtonLabel(voiceState, t)}
        </Button>
      ) : (
        <span className="self-center text-xs text-muted-foreground">
          {t('command.micUnsupported')}
        </span>
      )}
      {hasResult ? (
        <Button type="button" variant="ghost" onClick={onReset} disabled={busy}>
          {t('command.editSentence')}
        </Button>
      ) : null}
    </div>
  )
}

export function VoiceErrorAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

export function CommandErrorAlert({
  error,
  message,
  onReset,
}: {
  error: CommandError
  message: string
  onReset: () => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
    >
      <p>{message}</p>
      {error.detail && error.code !== 'COMMAND_ID_REUSED' ? (
        <p className="text-muted-foreground">{error.detail}</p>
      ) : null}
      <Button type="button" size="sm" variant="outline" onClick={onReset}>
        {t('command.rereview')}
      </Button>
    </div>
  )
}

export function ClarificationBlock({
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

export function PendingProposalSection({
  proposal,
  busy,
  onApply,
}: {
  proposal: WorkshopCommandProposal
  busy: boolean
  onApply: () => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <section aria-labelledby="workshop-command-pending" className="space-y-1 rounded-md border p-2">
      <h3 id="workshop-command-pending" className="text-sm font-semibold">
        {t('command.pendingHeading')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t('command.pendingHint', { id: proposal.pending_action_id })}
      </p>
      <p className="text-xs font-medium">{t('command.pendingNotApplied')}</p>
      <Button type="button" size="sm" onClick={onApply} disabled={busy}>
        {busy ? t('command.applying') : t('command.applyNow')}
      </Button>
    </section>
  )
}

export function AppliedSection({ onOpenOrders }: { onOpenOrders?: () => void }) {
  const { t } = useTranslation('workshop')
  return (
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
  )
}
