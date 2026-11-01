import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  type WorkshopCommandClarification,
  type WorkshopCommandIntent,
  type WorkshopCommandResponse,
} from '@/api/workshop-command'
import { errorText } from './command-error'
import { useWorkshopCommandFlow } from './use-workshop-command-flow'
import { useWorkshopCommandVoice } from './useWorkshopCommandVoice'
import { WorkshopCommandPreview } from './WorkshopCommandPreview'
import {
  AppliedSection,
  ClarificationBlock,
  CommandErrorAlert,
  CommandHeader,
  CommandSentenceField,
  CommandToolbar,
  PendingProposalSection,
  VoiceErrorAlert,
} from './WorkshopCommandSections'

export interface WorkshopCommandPanelProps {
  onExit: () => void
  onOpenOrders?: () => void
}

export function WorkshopCommandPanel({ onExit, onOpenOrders }: WorkshopCommandPanelProps) {
  const flow = useWorkshopCommandFlow()
  const voice = useWorkshopCommandVoice(flow.acceptTranscript)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  // The palette hands focus to its own input; in command mode the sentence is the entry point.
  React.useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canReview = flow.text.trim().length > 0 && !flow.busy

  return (
    <div className="space-y-3 px-3 pb-3 pt-2">
      <CommandHeader busy={flow.busy} onExit={onExit} />
      <CommandSentenceField
        textareaRef={textareaRef}
        text={flow.text}
        source={flow.source}
        disabled={flow.busy || voice.state === 'transcribing'}
        onChange={flow.changeText}
      />
      <CommandToolbar
        busy={flow.busy}
        hasResult={Boolean(flow.result)}
        canReview={canReview}
        voiceSupported={voice.supported}
        voiceState={voice.state}
        onReview={flow.review}
        onVoice={voice.toggle}
        onReset={flow.resetReview}
      />
      <VoiceErrorAlert message={voice.error} />
      <CommandReview
        result={flow.result}
        error={flow.error}
        busy={flow.busy}
        onReset={flow.resetReview}
        onChoose={flow.choose}
        onApply={() => void flow.propose()}
        proposalDisabled={Boolean(flow.proposal)}
      />
      {flow.proposal && !flow.applied ? (
        <PendingProposalSection
          proposal={flow.proposal}
          busy={flow.busy}
          onApply={() => void flow.applyProposal()}
        />
      ) : null}
      {flow.applied ? <AppliedSection onOpenOrders={onOpenOrders} /> : null}
    </div>
  )
}

function CommandReview({
  result,
  error,
  busy,
  onReset,
  onChoose,
  onApply,
  proposalDisabled,
}: {
  result: WorkshopCommandResponse | null
  error: ReturnType<typeof useWorkshopCommandFlow>['error']
  busy: boolean
  onReset: () => void
  onChoose: (clarification: WorkshopCommandClarification, choiceId: string) => void
  onApply: () => void
  proposalDisabled: boolean
}) {
  const { t } = useTranslation('workshop')
  return (
    <>
      {error ? (
        <CommandErrorAlert error={error} message={errorText(error, t)} onReset={onReset} />
      ) : null}
      <CommandResult
        result={result}
        busy={busy}
        onReset={onReset}
        onChoose={onChoose}
        onApply={onApply}
        proposalDisabled={proposalDisabled}
      />
    </>
  )
}

function CommandResult({
  result,
  busy,
  onReset,
  onChoose,
  onApply,
  proposalDisabled,
}: {
  result: WorkshopCommandResponse | null
  busy: boolean
  onReset: () => void
  onChoose: (clarification: WorkshopCommandClarification, choiceId: string) => void
  onApply: () => void
  proposalDisabled: boolean
}) {
  if (result?.status === 'clarification') {
    return (
      <ClarificationBlock
        clarification={result}
        busy={busy}
        onChoose={(choiceId) => onChoose(result, choiceId)}
      />
    )
  }
  if (result?.status !== 'ready') return null
  return (
    <WorkshopCommandPreview
      intent={result as WorkshopCommandIntent}
      busy={busy}
      applyDisabled={proposalDisabled}
      onEditSentence={onReset}
      onApply={onApply}
    />
  )
}
