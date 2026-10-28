import * as React from 'react'
import {
  applyWorkshopCommandProposal,
  interpretWorkshopCommand,
  proposeWorkshopCommand,
  type WorkshopCommandClarification,
  type WorkshopCommandProposal,
  type WorkshopCommandProposalStatus,
  type WorkshopCommandResponse,
  type WorkshopCommandSelection,
  type WorkshopCommandSource,
} from '@/api/workshop-command'
import { toCommandError, type CommandError } from './command-error'

function newCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `command-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function withSelection(
  selections: WorkshopCommandSelection[],
  next: WorkshopCommandSelection,
): WorkshopCommandSelection[] {
  return [...selections.filter((entry) => entry.slot !== next.slot), next]
}

/** Review state machine for one command: interpret, clarify, propose, apply. */
export function useWorkshopCommandFlow() {
  const [text, setTextValue] = React.useState('')
  const [source, setSource] = React.useState<WorkshopCommandSource>('keyboard')
  const [commandId, setCommandId] = React.useState(newCommandId)
  const [selections, setSelections] = React.useState<WorkshopCommandSelection[]>([])
  const [result, setResult] = React.useState<WorkshopCommandResponse | null>(null)
  const [proposal, setProposal] = React.useState<WorkshopCommandProposal | null>(null)
  const [applied, setApplied] = React.useState<WorkshopCommandProposalStatus | null>(null)
  const [error, setError] = React.useState<CommandError | null>(null)
  const [busy, setBusy] = React.useState(false)

  const resetReview = () => {
    setCommandId(newCommandId())
    setSelections([])
    setResult(null)
    setProposal(null)
    setApplied(null)
    setError(null)
  }

  const changeText = (value: string) => {
    setTextValue(value)
    setSource('keyboard')
    if (result || proposal || applied || error) resetReview()
  }

  const acceptTranscript = (transcript: string) => {
    setTextValue(transcript)
    setSource('voice_transcript')
    resetReview()
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

  const review = () => {
    if (!text.trim()) return
    void runInterpret(selections)
  }

  const choose = (
    clarification: WorkshopCommandClarification,
    choiceId: string,
  ) => {
    const choice = clarification.choices.find(
      (entry) => entry.choice_id === choiceId,
    )
    if (!choice) return
    void runInterpret(
      withSelection(selections, { slot: choice.slot, value: choice.value }),
    )
  }

  const propose = async () => {
    if (result?.status !== 'ready') return
    setBusy(true)
    setError(null)
    try {
      setProposal(await proposeWorkshopCommand({ commandId, selections }))
    } catch (failure) {
      setError(toCommandError(failure))
    } finally {
      setBusy(false)
    }
  }

  const applyProposal = async () => {
    if (!proposal) return
    setBusy(true)
    setError(null)
    try {
      setApplied(await applyWorkshopCommandProposal(proposal.pending_action_id))
    } catch (failure) {
      setError(toCommandError(failure))
    } finally {
      setBusy(false)
    }
  }

  return {
    text,
    source,
    selections,
    result,
    proposal,
    applied,
    error,
    busy,
    resetReview,
    changeText,
    acceptTranscript,
    review,
    choose,
    propose,
    applyProposal,
  }
}
