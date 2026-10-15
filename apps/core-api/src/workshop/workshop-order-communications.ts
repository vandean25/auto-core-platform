import type {
  EstimateApprovalChannel,
  EstimateApprovalDecision,
  EstimateNotificationChannel,
  NotificationOutboxStatus,
} from '@prisma/client';
import type {
  WorkshopCommunicationStatus,
  WorkshopOrderCommunicationDto,
} from './dto/workshop-order-communications.dto.js';

/** Entries one timeline returns, newest first. Each source is read with the same cap, so the merge is complete. */
export const WORKSHOP_COMMUNICATIONS_LIMIT = 100;

/** The customer's view of an estimate email. The internal states PENDING and SENDING read as one: QUEUED. */
const EMAIL_STATUS: Record<
  NotificationOutboxStatus,
  WorkshopCommunicationStatus
> = {
  PENDING: 'QUEUED',
  SENDING: 'QUEUED',
  ACCEPTED: 'SENT',
  FAILED: 'FAILED',
  SUPPRESSED: 'SUPPRESSED',
};

export interface EstimateEmailRecord {
  id: string;
  status: NotificationOutboxStatus;
  createdAt: Date;
  source_entity_id: string | null;
}

export interface EstimateApprovalRecord {
  id: string;
  workshop_estimate_version_id: string;
  channel: EstimateApprovalChannel;
  decision: EstimateApprovalDecision;
  decided_at: Date;
}

/**
 * An overrun record of this order (AUT-355). It yields a detection entry, and a notice entry once the customer was
 * told. The notice fields are those of the latest notice.
 */
export interface OverrunRecord {
  id: string;
  workshop_estimate_version_id: string;
  detected_at: Date;
  notified_at: Date | null;
  notified_channel: EstimateNotificationChannel | null;
}

export interface WorkshopCommunicationsInput {
  emails: EstimateEmailRecord[];
  approvals: EstimateApprovalRecord[];
  /** Overrun records of this order. Empty when the order has none. */
  overrunRecords?: OverrunRecord[];
  /** Version number by version id, for the versions of this order. */
  versionNumbers: ReadonlyMap<string, number>;
}

interface TimedEntry {
  id: string;
  at: Date;
  dto: WorkshopOrderCommunicationDto;
}

/** The entries of one overrun record: when it was found, and when the customer was told (if they were). */
function overrunEntries(
  row: OverrunRecord,
  versionNumbers: ReadonlyMap<string, number>,
): TimedEntry[] {
  const version = versionNumbers.get(row.workshop_estimate_version_id) ?? null;
  const detection: TimedEntry = {
    id: row.id,
    at: row.detected_at,
    dto: {
      id: row.id,
      kind: 'OVERRUN_DETECTED',
      channel: null,
      version,
      occurred_at: row.detected_at.toISOString(),
      status: null,
      decision: null,
    },
  };
  if (row.notified_at === null || row.notified_channel === null) {
    return [detection];
  }
  return [
    detection,
    {
      id: row.id,
      at: row.notified_at,
      dto: {
        id: row.id,
        kind: 'OVERRUN_NOTIFICATION',
        channel: row.notified_channel,
        version,
        occurred_at: row.notified_at.toISOString(),
        status: null,
        decision: null,
      },
    },
  ];
}

/**
 * The customer side of one order as a single list (runbook §2d): the estimate emails, the decisions taken on them and
 * the overrun entries, newest first. Each entry is built from the fields listed here only, so no address, body,
 * subject or typed name leaves the server through this list.
 */
export function buildWorkshopOrderCommunications({
  emails,
  approvals,
  overrunRecords = [],
  versionNumbers,
}: WorkshopCommunicationsInput): WorkshopOrderCommunicationDto[] {
  const entries: TimedEntry[] = [
    ...emails.map((row): TimedEntry => ({
      id: row.id,
      at: row.createdAt,
      dto: {
        id: row.id,
        kind: 'ESTIMATE_EMAIL',
        channel: 'EMAIL',
        version:
          row.source_entity_id === null
            ? null
            : (versionNumbers.get(row.source_entity_id) ?? null),
        occurred_at: row.createdAt.toISOString(),
        status: EMAIL_STATUS[row.status],
        decision: null,
      },
    })),
    ...overrunRecords.flatMap((row) => overrunEntries(row, versionNumbers)),
    ...approvals.map((row): TimedEntry => ({
      id: row.id,
      at: row.decided_at,
      dto: {
        id: row.id,
        kind: 'ESTIMATE_APPROVAL',
        channel: row.channel,
        version: versionNumbers.get(row.workshop_estimate_version_id) ?? null,
        occurred_at: row.decided_at.toISOString(),
        status: null,
        decision: row.decision,
      },
    })),
  ];

  // Ties on the time fall back to the id, so two reads of the same rows return the same order.
  entries.sort(
    (a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id),
  );
  return entries
    .slice(0, WORKSHOP_COMMUNICATIONS_LIMIT)
    .map((entry) => entry.dto);
}
