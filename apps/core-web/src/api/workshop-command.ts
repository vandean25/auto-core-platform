import { fetchWithAuth } from './client'
import { throwApiResponseError } from './api-error'
import type { components } from './generated/openapi'

export type WorkshopCommandSelection = components['schemas']['CommandSelectionDto']
export type WorkshopCommandIntent = components['schemas']['WorkshopCommandIntentDto']
export type WorkshopCommandClarification =
  components['schemas']['WorkshopCommandClarificationDto']
export type WorkshopCommandProposal =
  components['schemas']['WorkshopCommandProposalResultDto']
export type WorkshopCommandResponse =
  | WorkshopCommandIntent
  | WorkshopCommandClarification
export type WorkshopCommandTranscript = components['schemas']['VoiceTranscriptResponseDto']
export type WorkshopCommandProposalStatus = components['schemas']['AgentProposalResponseDto']

export const WORKSHOP_COMMAND_CONTRACT_VERSION = 'workshop-command/v1'
export const WORKSHOP_COMMAND_LOCALE = 'de-AT'
export const WORKSHOP_COMMAND_MAX_TEXT_LENGTH = 500

export type WorkshopCommandSource = 'keyboard' | 'voice_transcript'

export interface InterpretWorkshopCommandPayload {
  commandId: string
  text: string
  source: WorkshopCommandSource
  selections?: WorkshopCommandSelection[]
}

export async function interpretWorkshopCommand(
  payload: InterpretWorkshopCommandPayload,
): Promise<WorkshopCommandResponse> {
  const response = await fetchWithAuth('/api/workshop/commands/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contract_version: WORKSHOP_COMMAND_CONTRACT_VERSION,
      command_id: payload.commandId,
      source: payload.source,
      locale: WORKSHOP_COMMAND_LOCALE,
      text: payload.text,
      ...(payload.selections?.length ? { selections: payload.selections } : {}),
    }),
  })
  if (!response.ok) {
    await throwApiResponseError(response, 'Failed to interpret workshop command')
  }
  return response.json()
}

export async function proposeWorkshopCommand(payload: {
  commandId: string
  selections?: WorkshopCommandSelection[]
}): Promise<WorkshopCommandProposal> {
  const response = await fetchWithAuth('/api/workshop/commands/propose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contract_version: WORKSHOP_COMMAND_CONTRACT_VERSION,
      command_id: payload.commandId,
      ...(payload.selections?.length ? { selections: payload.selections } : {}),
    }),
  })
  if (!response.ok) {
    await throwApiResponseError(response, 'Failed to propose workshop command')
  }
  return response.json()
}

/** Explicit apply of the reviewed proposal. Nothing is written before this call succeeds. */
export async function applyWorkshopCommandProposal(
  proposalId: string,
): Promise<WorkshopCommandProposalStatus> {
  const response = await fetchWithAuth(
    `/api/agent-proposals/${encodeURIComponent(proposalId)}/apply`,
    { method: 'POST' },
  )
  if (!response.ok) {
    await throwApiResponseError(response, 'Failed to apply workshop command proposal')
  }
  return response.json()
}

/** Speech-to-text only. The transcript is editable and never sent to a model provider. */
export async function transcribeWorkshopAudio(
  audio: Blob,
): Promise<WorkshopCommandTranscript> {
  const form = new FormData()
  const extension = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'
  form.append('audio', audio, `workshop-command.${extension}`)
  const response = await fetchWithAuth('/api/voice-translation/transcribe', {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    await throwApiResponseError(response, 'Failed to transcribe workshop command')
  }
  return response.json()
}
