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

/** Keyset cursor: sort position of the last row on the previous page. */
export interface SupervisionTriageCursor {
  kind: SupervisionTriageKind;
  due_at: string | null;
  created_at: string;
  entity_id: string;
}

export class InvalidSupervisionTriageCursorError extends Error {
  constructor(message = 'Invalid supervision triage cursor') {
    super(message);
    this.name = 'InvalidSupervisionTriageCursorError';
  }
}

export function encodeSupervisionTriageCursor(
  item: SupervisionTriageCandidate,
): string {
  const cursor: SupervisionTriageCursor = {
    kind: item.kind,
    due_at: item.due_at ? item.due_at.toISOString() : null,
    created_at: item.created_at.toISOString(),
    entity_id: item.entity_id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeSupervisionTriageCursor(
  raw: string | undefined,
): SupervisionTriageCursor | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as SupervisionTriageCursor;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.kind !== 'string' ||
      !Object.prototype.hasOwnProperty.call(KIND_RANK, parsed.kind) ||
      (parsed.due_at !== null && typeof parsed.due_at !== 'string') ||
      typeof parsed.created_at !== 'string' ||
      typeof parsed.entity_id !== 'string' ||
      parsed.entity_id.length === 0
    ) {
      throw new InvalidSupervisionTriageCursorError();
    }
    return parsed;
  } catch (error) {
    if (error instanceof InvalidSupervisionTriageCursorError) {
      throw error;
    }
    throw new InvalidSupervisionTriageCursorError();
  }
}

function cursorToCandidate(
  cursor: SupervisionTriageCursor,
): SupervisionTriageCandidate {
  return {
    kind: cursor.kind,
    entity_id: cursor.entity_id,
    site_id: '',
    reason: '',
    created_at: new Date(cursor.created_at),
    due_at: cursor.due_at ? new Date(cursor.due_at) : null,
    record_link: '',
    allowed_action: 'OPEN_RECORD',
  };
}

function isStrictlyAfterCursor(
  item: SupervisionTriageCandidate,
  cursor: SupervisionTriageCursor,
): boolean {
  const cursorItem = cursorToCandidate(cursor);
  return compareSupervisionTriageCandidates(cursorItem, item) < 0;
}

export function paginateSupervisionTriageCandidates(
  sorted: SupervisionTriageCandidate[],
  limit: number,
  cursorRaw?: string,
): { page: SupervisionTriageCandidate[]; next_cursor: string | null } {
  const cursor = decodeSupervisionTriageCursor(cursorRaw);
  const startIndex =
    cursor === null
      ? 0
      : sorted.findIndex((item) => isStrictlyAfterCursor(item, cursor));
  const offset = startIndex === -1 ? sorted.length : startIndex;
  const page = sorted.slice(offset, offset + limit);
  const next_cursor =
    offset + page.length < sorted.length
      ? encodeSupervisionTriageCursor(page[page.length - 1]!)
      : null;
  return { page, next_cursor };
}
