import type { SupervisionTriageKind } from './dto/agent-supervision-triage.dto.js';

/** Merged inbox row before API mapping. */
export interface SupervisionTriageCandidate {
  kind: SupervisionTriageKind;
  entity_id: string;
  site_id: string;
  reason: string;
  created_at: Date;
  due_at: Date | null;
  record_link: string;
  allowed_action: 'APPROVE_REJECT' | 'OPEN_RECORD';
}

const KIND_RANK: Record<SupervisionTriageKind, number> = {
  OVERDUE_LOANER: 0,
  CUSTOMER_WAITING: 1,
  PENDING_APPROVAL: 2,
};

function dueSortKey(dueAt: Date | null): string {
  return dueAt ? dueAt.toISOString() : '\uffff';
}

export function compareSupervisionTriageCandidates(
  left: SupervisionTriageCandidate,
  right: SupervisionTriageCandidate,
): number {
  const kindDelta = KIND_RANK[left.kind] - KIND_RANK[right.kind];
  if (kindDelta !== 0) {
    return kindDelta;
  }

  const dueDelta = dueSortKey(left.due_at).localeCompare(
    dueSortKey(right.due_at),
  );
  if (dueDelta !== 0) {
    return dueDelta;
  }

  const createdDelta = left.created_at.getTime() - right.created_at.getTime();
  if (createdDelta !== 0) {
    return createdDelta;
  }

  return left.entity_id.localeCompare(right.entity_id);
}

export function sortSupervisionTriageCandidates(
  items: SupervisionTriageCandidate[],
): SupervisionTriageCandidate[] {
  return [...items].sort(compareSupervisionTriageCandidates);
}

export interface SupervisionTriageCursor {
  offset: number;
}

export function encodeSupervisionTriageCursor(
  cursor: SupervisionTriageCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeSupervisionTriageCursor(
  raw: string | undefined,
): SupervisionTriageCursor {
  if (!raw) {
    return { offset: 0 };
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as SupervisionTriageCursor;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.offset !== 'number' ||
      parsed.offset < 0 ||
      !Number.isInteger(parsed.offset)
    ) {
      return { offset: 0 };
    }
    return parsed;
  } catch {
    return { offset: 0 };
  }
}

export function paginateSupervisionTriageCandidates(
  sorted: SupervisionTriageCandidate[],
  limit: number,
  cursorRaw?: string,
): { page: SupervisionTriageCandidate[]; next_cursor: string | null } {
  const { offset } = decodeSupervisionTriageCursor(cursorRaw);
  const page = sorted.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const next_cursor =
    nextOffset < sorted.length
      ? encodeSupervisionTriageCursor({ offset: nextOffset })
      : null;
  return { page, next_cursor };
}
