import * as React from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useAuthSession } from '@/api/auth-session'
import { Button } from '@/components/ui/button'
import { canApplyWorkshopCommand } from '@/features/actions/action-role-predicates'
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
    <header className="flex items-center gap-2 pr-12">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-action-id="workshopCommand.exit"
        onClick={onExit}
        disabled={busy}
        className="-ml-1 h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('command.backToSearch')}
      </Button>
      <div className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
      <h2 className="truncate text-sm font-semibold">{t('command.title')}</h2>
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
      <Button
        type="button"
        data-action-id="workshopCommand.review"
        onClick={onReview}
        disabled={!canReview}
      >
        {hasResult ? t('command.rereview') : t('command.review')}
      </Button>
      {voiceSupported ? (
        <Button
          type="button"
          variant="outline"
          data-action-id="workshopCommand.dictate"
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
        <Button
          type="button"
          variant="ghost"
          data-action-id="workshopCommand.edit"
          onClick={onReset}
          disabled={busy}
        >
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
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-action-id="workshopCommand.reset"
        onClick={onReset}
      >
        {t('command.reset')}
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
  const prompt = t(`command.clarificationPrompts.${clarification.code}`, {
    defaultValue: clarification.prompt,
  })
  return (
    <section
      aria-labelledby="workshop-command-clarification"
      className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-2"
    >
      <h3 id="workshop-command-clarification" className="text-sm font-semibold">
        {t('command.clarificationHeading')}
      </h3>
      <p className="text-sm">{prompt}</p>
      {clarification.has_more ? (
        <p className="text-xs text-muted-foreground">{t('command.hasMore')}</p>
      ) : null}
      {clarification.choices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {clarification.choices.map((choice) => (
            <Button
              key={choice.choice_id}
              type="button"
              size="sm"
              variant="outline"
              data-action-id="workshopCommand.choose"
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
  proposal: _proposal,
  busy,
  onApply,
}: {
  proposal: WorkshopCommandProposal
  busy: boolean
  onApply: () => void
}) {
  const { t } = useTranslation('workshop')
  const role = useAuthSession().data?.activeRole
  const canApply = canApplyWorkshopCommand(role)
  return (
    <section aria-labelledby="workshop-command-pending" className="space-y-2 rounded-md border p-2">
      <h3 id="workshop-command-pending" className="text-sm font-semibold">
        {t('command.pendingHeading')}
      </h3>
      {canApply ? (
        <Button
          type="button"
          size="sm"
          data-action-id="workshopCommand.applyNow"
          onClick={onApply}
          disabled={busy}
        >
          {busy ? t('command.applying') : t('command.applyNow')}
        </Button>
      ) : null}
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
      {onOpenOrders ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-action-id="workshopCommand.openOrders"
          onClick={onOpenOrders}
        >
          {t('command.openOrders')}
        </Button>
      ) : null}
    </section>
  )
}
