import type { WorkshopEstimateStatus, WorkshopEstimateVersionSummary } from '@/api/workshop-estimates'
import { formatCurrency } from '@/lib/format'
import { i18n } from '@/lib/i18n'

function workshopT(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key as never, { ns: 'workshop', ...options }))
}

type EstimateApprovalSummary = NonNullable<WorkshopEstimateVersionSummary['approval']>

/**
 * Copy and input rules for advisor-recorded estimate decisions and overrun notices (AUT-355). The backend stays
 * authoritative for every rule; these helpers only shape what the advisor sees and what the form sends.
 */

export type AdvisorChannel = 'PHONE' | 'IN_PERSON' | 'EMAIL'
export type CustomerReaction = 'AGREED' | 'DECLINED' | 'QUESTIONED' | 'CALLBACK_REQUESTED' | 'NO_RESPONSE'
export type EstimateDecision = 'APPROVED' | 'DECLINED'

const ADVISOR_CHANNELS: AdvisorChannel[] = ['PHONE', 'IN_PERSON', 'EMAIL']
const CUSTOMER_REACTIONS: CustomerReaction[] = [
  'AGREED',
  'DECLINED',
  'QUESTIONED',
  'CALLBACK_REQUESTED',
  'NO_RESPONSE',
]

export function advisorChannelOptions(): ReadonlyArray<{ value: AdvisorChannel; label: string }> {
  return ADVISOR_CHANNELS.map((value) => ({
    value,
    label: i18n.t(`estimateDecision.advisorChannel.${value}`, { ns: 'workshop' }),
  }))
}

export function customerReactionOptions(): ReadonlyArray<{ value: CustomerReaction; label: string }> {
  return CUSTOMER_REACTIONS.map((value) => ({
    value,
    label: i18n.t(`estimateDecision.customerReaction.${value}`, { ns: 'workshop' }),
  }))
}

/** The reactions that fit a recorded decision. The same rule the backend applies (AUT-355). */
const REACTIONS_FOR_DECISION: Record<EstimateDecision, ReadonlyArray<CustomerReaction>> = {
  APPROVED: ['AGREED', 'QUESTIONED'],
  DECLINED: ['DECLINED', 'QUESTIONED', 'CALLBACK_REQUESTED'],
}

/** The reaction choices for a decision: an approval is not answered with a refusal, and a refusal not with agreement. */
export function reactionOptionsFor(
  decision: EstimateDecision,
): ReadonlyArray<{ value: CustomerReaction; label: string }> {
  const allowed = REACTIONS_FOR_DECISION[decision]
  return customerReactionOptions().filter((option) => allowed.includes(option.value))
}

export function formatEstimateMoney(value: string | null | undefined): string {
  return value == null ? '—' : formatCurrency(Number(value))
}

const NOTE_MIN_LENGTH = 3
const NOTE_MAX_LENGTH = 500

/** Status of one estimate version, as the version rows of the work order name it. */
export function estimateVersionStatusLabel(status: WorkshopEstimateStatus): string {
  return workshopT(`estimateCard.status.${status}`)
}

/** The derived badge of the estimate, next to its number. The order itself has no estimate status. */
export function estimateBadgeLabel(status: WorkshopEstimateStatus): string {
  return i18n.t(`estimateDecision.badge.${status}`, { ns: 'workshop' })
}

/**
 * One line about how a decision was reached. A customer link decision is electronically confirmed (never digitally
 * signed); an advisor-recorded decision says who recorded it and how the customer answered.
 */
export function describeApproval(approval: EstimateApprovalSummary): string {
  const approved = approval.decision === 'APPROVED'
  if (approval.channel === 'LINK') {
    return approved
      ? i18n.t('estimateDecision.approval.linkApproved', { ns: 'workshop' })
      : i18n.t('estimateDecision.approval.linkDeclined', { ns: 'workshop' })
  }
  const outcomeKey = approved ? 'approved' : 'declined'
  const channelPhraseKey = `estimateDecision.approval.channelPhrase.${approval.channel}`
  const viaPhrase =
    approval.channel && i18n.exists(channelPhraseKey, { ns: 'workshop' })
      ? workshopT(channelPhraseKey)
      : ''
  const via = viaPhrase ? ` ${viaPhrase}` : ''
  return i18n.t(`estimateDecision.approval.advisorRecorded.${outcomeKey}`, {
    ns: 'workshop',
    via,
  })
}

/** Normalises what the advisor typed into a gross amount with two decimals, or returns null when it is not one. */
export function normalizeGrossAmount(input: string): string | null {
  const candidate = input.trim().replace(',', '.')
  if (!/^\d{1,8}\.\d{2}$/.test(candidate)) return null
  return candidate
}

export function isSameGrossAmount(quoted: string, total: string | null | undefined): boolean {
  if (total == null) return false
  return Number(quoted) === Number(total)
}

export function isRecordableNote(note: string): boolean {
  const length = note.trim().length
  return length >= NOTE_MIN_LENGTH && length <= NOTE_MAX_LENGTH
}

const RECORD_DECISION_ERROR_CODES = [
  'ESTIMATE_VERSION_NOT_SENT',
  'ESTIMATE_VERSION_SUPERSEDED',
  'ESTIMATE_VERSION_EXPIRED',
  'ESTIMATE_VERSION_ALREADY_DECIDED',
  'ESTIMATE_VERSION_NOT_DECIDABLE',
  'ESTIMATE_REACTION_MISMATCH',
  'ESTIMATE_AMOUNT_MISMATCH',
  'ESTIMATE_DECISION_TIME_INVALID',
  'ESTIMATE_DECISION_CONFLICT',
  'ESTIMATE_ROLE_FORBIDDEN',
] as const

const OVERRUN_NOTICE_ERROR_CODES = [
  'OVERRUN_NOT_DETECTED',
  'OVERRUN_ALREADY_NOTIFIED',
  'OVERRUN_NO_BASELINE',
  'OVERRUN_AMOUNT_MISMATCH',
  'WORKSHOP_ORDER_CLOSED',
  'ESTIMATE_ROLE_FORBIDDEN',
] as const

function buildErrorTable(codes: readonly string[], prefix: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    codes.map((code) => [code, workshopT(`${prefix}.${code}`)]),
  )
}

export function recordDecisionErrorMessages(): Readonly<Record<string, string>> {
  return buildErrorTable(RECORD_DECISION_ERROR_CODES, 'estimateDecision.errors.record')
}

export function overrunNoticeErrorMessages(): Readonly<Record<string, string>> {
  return buildErrorTable(OVERRUN_NOTICE_ERROR_CODES, 'estimateDecision.errors.overrun')
}

/** The message for a failed request: the code table first, then the generic text. */
export function messageForErrorCode(
  table: Readonly<Record<string, string>>,
  code: string | undefined,
  fallback: string,
): string {
  return (code && table[code]) || fallback
}
