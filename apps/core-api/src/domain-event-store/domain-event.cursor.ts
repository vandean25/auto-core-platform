import { DOMAIN_EVENT_CURSOR_VERSION } from './domain-event.constants.js';

export type DomainEventFeedCursor = {
  v: number;
  seq: string;
  id: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeDomainEventFeedCursor(
  position: { sequence: bigint; id: string },
): string {
  const cursor: DomainEventFeedCursor = {
    v: DOMAIN_EVENT_CURSOR_VERSION,
    seq: position.sequence.toString(),
    id: position.id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeDomainEventFeedCursor(
  encoded: string,
): DomainEventFeedCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const { v, seq, id } = parsed as Record<string, unknown>;
  if (v !== DOMAIN_EVENT_CURSOR_VERSION) {
    return null;
  }
  if (typeof seq !== 'string' || !/^\d+$/.test(seq)) {
    return null;
  }
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    return null;
  }
  return { v, seq, id };
}

export function sequenceFromCursor(cursor: DomainEventFeedCursor): bigint {
  return BigInt(cursor.seq);
}
