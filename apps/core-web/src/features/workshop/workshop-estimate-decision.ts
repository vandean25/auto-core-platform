import type { WorkshopEstimateStatus, WorkshopEstimateVersionSummary } from '@/api/workshop-estimates'
import { formatCurrency } from '@/lib/format'

type EstimateApprovalSummary = NonNullable<WorkshopEstimateVersionSummary['approval']>

/**
 * German copy and input rules for advisor-recorded estimate decisions and overrun notices (AUT-355). The backend stays
 * authoritative for every rule; these helpers only shape what the advisor sees and what the form sends.
 */

export type AdvisorChannel = 'PHONE' | 'IN_PERSON' | 'EMAIL'
export type CustomerReaction = 'AGREED' | 'DECLINED' | 'QUESTIONED' | 'CALLBACK_REQUESTED' | 'NO_RESPONSE'
export type EstimateDecision = 'APPROVED' | 'DECLINED'

export const ADVISOR_CHANNEL_OPTIONS: ReadonlyArray<{ value: AdvisorChannel; label: string }> = [
  { value: 'PHONE', label: 'Telefon' },
  { value: 'IN_PERSON', label: 'Persönlich' },
  { value: 'EMAIL', label: 'E-Mail' },
]

export const CUSTOMER_REACTION_OPTIONS: ReadonlyArray<{ value: CustomerReaction; label: string }> = [
  { value: 'AGREED', label: 'Zugestimmt' },
  { value: 'DECLINED', label: 'Abgelehnt' },
  { value: 'QUESTIONED', label: 'Rückfrage gestellt' },
  { value: 'CALLBACK_REQUESTED', label: 'Rückruf erbeten' },
  { value: 'NO_RESPONSE', label: 'Keine Reaktion' },
]

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
  return CUSTOMER_REACTION_OPTIONS.filter((option) => allowed.includes(option.value))
}

export function formatEstimateMoney(value: string | null | undefined): string {
  return value == null ? '—' : formatCurrency(Number(value))
}

const NOTE_MIN_LENGTH = 3
const NOTE_MAX_LENGTH = 500

/** The derived badge of the estimate, next to its number. The order itself has no estimate status. */
const ESTIMATE_BADGE_LABEL: Record<WorkshopEstimateStatus, string> = {
  DRAFT: 'Entwurf',
  SENT: 'Kunde ausstehend',
  APPROVED: 'Freigegeben',
  DECLINED: 'Abgelehnt',
  EXPIRED: 'Abgelaufen',
  SUPERSEDED: 'Ersetzt',
}

export function estimateBadgeLabel(status: WorkshopEstimateStatus): string {
  return ESTIMATE_BADGE_LABEL[status]
}

/** How the advisor took an advisor-recorded decision, as German words that follow "Freigabe" or "Ablehnung". */
const ADVISOR_CHANNEL_PHRASE: Partial<Record<string, string>> = {
  PHONE: 'telefonisch',
  IN_PERSON: 'persönlich',
  EMAIL: 'per E-Mail',
}

/**
 * One line about how a decision was reached. A customer link decision is "elektronisch bestätigt" (never "digital
 * signiert"); an advisor-recorded decision says who recorded it and how the customer answered.
 */
export function describeApproval(approval: EstimateApprovalSummary): string {
  const approved = approval.decision === 'APPROVED'
  if (approval.channel === 'LINK') {
    return approved ? 'Elektronisch bestätigt über den Kundenlink' : 'Über den Kundenlink abgelehnt'
  }
  const outcome = approved ? 'Freigabe' : 'Ablehnung'
  const via = ADVISOR_CHANNEL_PHRASE[approval.channel] ?? ''
  return `Vom Berater erfasst: ${outcome}${via ? ` ${via}` : ''}`
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

export const RECORD_DECISION_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ESTIMATE_VERSION_NOT_SENT: 'Nur ein gesendeter Kostenvoranschlag kann bestätigt werden.',
  ESTIMATE_VERSION_SUPERSEDED:
    'Diese Version wurde durch eine neuere ersetzt. Die Bestätigung gehört zur aktuellen Version.',
  ESTIMATE_VERSION_EXPIRED: 'Die Gültigkeit dieses Kostenvoranschlags ist abgelaufen.',
  ESTIMATE_VERSION_ALREADY_DECIDED: 'Zu diesem Kostenvoranschlag liegt bereits eine Entscheidung vor.',
  ESTIMATE_VERSION_NOT_DECIDABLE: 'Diese Version ist noch nicht vollständig gesendet und kann nicht bestätigt werden.',
  ESTIMATE_REACTION_MISMATCH: 'Die Reaktion des Kunden passt nicht zur gewählten Entscheidung.',
  ESTIMATE_AMOUNT_MISMATCH: 'Der Betrag stimmt nicht mit dem Gesamtbetrag des Kostenvoranschlags überein.',
  ESTIMATE_DECISION_TIME_INVALID:
    'Der Zeitpunkt der Entscheidung muss nach dem Versand liegen und darf nicht in der Zukunft liegen.',
  ESTIMATE_DECISION_CONFLICT: 'Der Kostenvoranschlag wurde gerade geändert. Bitte neu laden und erneut versuchen.',
  ESTIMATE_ROLE_FORBIDDEN: 'Für diese Aktion fehlt die Berechtigung.',
}

export const OVERRUN_NOTICE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  OVERRUN_NOT_DETECTED: 'Der Auftrag weicht derzeit nicht vom Kostenvoranschlag ab.',
  OVERRUN_ALREADY_NOTIFIED: 'Der Kunde wurde zu dieser Abweichung bereits informiert.',
  OVERRUN_NO_BASELINE: 'Es gibt noch keinen freigegebenen Kostenvoranschlag als Vergleich.',
  OVERRUN_AMOUNT_MISMATCH: 'Der Betrag stimmt nicht mit dem aktuellen Auftragsbetrag überein.',
  WORKSHOP_ORDER_CLOSED: 'Ein abgerechneter Auftrag braucht keine Mitteilung mehr.',
  ESTIMATE_ROLE_FORBIDDEN: 'Für diese Aktion fehlt die Berechtigung.',
}

/** The message for a failed request: the code table first, then the generic text. */
export function messageForErrorCode(
  table: Readonly<Record<string, string>>,
  code: string | undefined,
  fallback: string,
): string {
  return (code && table[code]) || fallback
}
