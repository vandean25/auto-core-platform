import type { TFunction } from 'i18next'

export type CommandError = {
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

function knownCode(value: unknown): string | undefined {
  return typeof value === 'string' && ERROR_CODES.has(value) ? value : undefined
}

function detailOf(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(' ')
  return value
}

export function toCommandError(error: unknown): CommandError {
  const failure = error as ApiFailure | undefined
  const data = failure?.data ?? {}
  return {
    code: knownCode(data.code),
    status: failure?.status,
    detail: detailOf(data.message),
  }
}

type Translate = TFunction<'workshop'>

const CODE_MESSAGES = {
  COMMAND_ID_REUSED: 'command.errorCommandIdReused',
  SELECTION_NOT_OFFERED: 'command.errorSelectionNotOffered',
  PLAN_STALE: 'command.errorPlanStale',
  INTENT_INCOMPLETE: 'command.errorIntentIncomplete',
  SESSION_NOT_FOUND: 'command.errorSessionNotFound',
} as const

export function errorText(error: CommandError, t: Translate): string {
  const key =
    error.code && error.code in CODE_MESSAGES
      ? CODE_MESSAGES[error.code as keyof typeof CODE_MESSAGES]
      : undefined
  if (key) return t(key)
  if (error.status === 403) return t('command.errorForbidden')
  return t('command.errorGeneric')
}

export function voiceErrorMessage(error: CommandError, t: Translate): string {
  if (error.code === 'TRANSCRIPT_EMPTY') return t('command.transcriptEmpty')
  if (error.status === 503) return t('command.sttNotConfigured')
  return t('command.sttFailed')
}
