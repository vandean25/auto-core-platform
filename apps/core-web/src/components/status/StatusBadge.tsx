import { formatStatusLabel } from '@/lib/i18n/enum-labels'
import { cn } from '@/lib/utils'

export { formatStatusLabel }

interface StatusBadgeProps {
  status: string
  label?: string
  className?: string
}

/*
 * Tones come from the theme tokens (AUT-655). Colour follows what the state means, and the label
 * carries the same meaning, so colour is never the only signal.
 */
const NEUTRAL = 'border-border bg-muted text-muted-foreground'
const INFO = 'border-info/30 bg-info/10 text-info'
const SUCCESS = 'border-success/30 bg-success/10 text-success'
const WARNING = 'border-warning/40 bg-warning/10 text-warning'
const DESTRUCTIVE = 'border-destructive/30 bg-destructive/10 text-destructive'

const statusClassMap: Record<string, string> = {
  DRAFT: NEUTRAL,
  SUBMITTED_EXTERNALLY: INFO,
  CLOSED: NEUTRAL,
  CLOCKED_IN: SUCCESS,
  CLOCKED_OUT: NEUTRAL,
  AT_DOCTOR: INFO,
  BOOKED: SUCCESS,
  SCHEDULED: NEUTRAL,
  SENT: INFO,
  DECLINED: DESTRUCTIVE,
  INTAKE: INFO,
  CONFIRMED: INFO,
  NOT_STARTED: NEUTRAL,
  IN_PROGRESS: WARNING,
  WAITING_PARTS: WARNING,
  WAITING_CUSTOMER: INFO,
  PAUSED: WARNING,
  PARTIAL: WARNING,
  COMPLETED: SUCCESS,
  DONE: SUCCESS,
  INVOICED: INFO,
  FINALIZED: INFO,
  ISSUED: INFO,
  POSTED: INFO,
  PAID: SUCCESS,
  CANCELLED: DESTRUCTIVE,
  OUT_OF_STOCK: DESTRUCTIVE,
  IN_STOCK: SUCCESS,
  ON_ORDER: INFO,
  RESERVED: WARNING,
  IN_PREP: INFO,
  SOLD: SUCCESS,
  RECEIVED: SUCCESS,
  USED: SUCCESS,
  SUPERSEDED: WARNING,
  ACTIVE: SUCCESS,
  INACTIVE: NEUTRAL,
  QUALIFICATION_CURRENT: SUCCESS,
  QUALIFICATION_EXPIRED: DESTRUCTIVE,
  QUALIFICATION_UNKNOWN: WARNING,
  EVIDENCE_REVIEWED: SUCCESS,
  UNREVIEWED: WARNING,
  SOURCE_CONFLICT: DESTRUCTIVE,
  CURRENT: SUCCESS,
  OUT_OF_SCOPE: NEUTRAL,
  CONTINUATION: INFO,
  NOT_YET_VALID: WARNING,
  // Audit statuses
  CREATE: INFO,
  UPDATE: WARNING,
  DELETE: DESTRUCTIVE,
  // Accounting export readiness
  EXPORTABLE: SUCCESS,
  BLOCKED: DESTRUCTIVE,
  // Parts status
  READY: SUCCESS,
  SHORTAGE: DESTRUCTIVE,
  WAITING: WARNING,
  NO_PARTS: NEUTRAL,
  REQUESTED: INFO,
  APPROVED: INFO,
  SHIPPED: WARNING,
  REJECTED: DESTRUCTIVE,
  VOID: NEUTRAL,
  AVAILABLE: SUCCESS,
  ON_LOAN: INFO,
  MAINTENANCE: WARNING,
  RETIRED: NEUTRAL,
  HANDED_OVER: INFO,
  RETURNED: SUCCESS,
  NO_SHOW: DESTRUCTIVE,
  OK: SUCCESS,
  DUE_SOON: WARNING,
  OVERDUE: DESTRUCTIVE,
  UNKNOWN: NEUTRAL,
  IN_STORAGE: SUCCESS,
  ON_VEHICLE: INFO,
  DISPOSED: NEUTRAL,
  SUMMER: WARNING,
  WINTER: INFO,
  ALL_SEASON: INFO,
  CHECK_IN: SUCCESS,
  CHECK_OUT: INFO,
  INSPECTED: NEUTRAL,
  // Agent supervision statuses & tiers
  PENDING: WARNING,
  EXECUTED: SUCCESS,
  FAILED: DESTRUCTIVE,
  EXPIRED: NEUTRAL,
  REVOKED: DESTRUCTIVE,
  AUTO: SUCCESS,
  PROPOSE: WARNING,
  HUMAN_ONLY: INFO,
  NOT_EVALUATED: NEUTRAL,
  // Gewährleistung (vehicle sale warranty); labels come from gewaehrleistungStatusBadge
  GEWAEHRLEISTUNG_ACTIVE: SUCCESS,
  GEWAEHRLEISTUNG_EXPIRING_SOON: WARNING,
  GEWAEHRLEISTUNG_EXPIRED: DESTRUCTIVE,
  AWAITING_REVIEW: WARNING,
  APPLIED: SUCCESS,
  ABORTED: NEUTRAL,
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium leading-none',
        statusClassMap[status] ?? NEUTRAL,
        className,
      )}
    >
      {label ?? formatStatusLabel(status)}
    </span>
  )
}
