import { BadRequestException } from '@nestjs/common';
import {
  CUSTOMER_ACTIVITY_TYPES,
  type CustomerActivityCursor,
  type CustomerActivityItem,
  type CustomerActivityType,
} from './customer-activity.types.js';

const TYPE_SET = new Set<string>(CUSTOMER_ACTIVITY_TYPES);

export const DEFAULT_ACTIVITY_LIMIT = 25;
export const MAX_ACTIVITY_LIMIT = 100;

export function resolveActivityLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_ACTIVITY_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_ACTIVITY_LIMIT);
}

export function parseActivityTypesFilter(
  rawTypes?: string,
): Set<CustomerActivityType> | null {
  if (!rawTypes || rawTypes.trim().length === 0) {
    return null;
  }
  const parsed = rawTypes
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parsed.length === 0) {
    return null;
  }
  for (const entry of parsed) {
    if (!TYPE_SET.has(entry)) {
      throw new BadRequestException(`Unknown activity type: ${entry}`);
    }
  }
  return new Set(parsed as CustomerActivityType[]);
}

export function encodeActivityCursor(cursor: CustomerActivityCursor): string {
  return Buffer.from(
    JSON.stringify({
      t: cursor.occurredAt.toISOString(),
      y: cursor.type,
      i: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeActivityCursor(
  rawCursor?: string,
): CustomerActivityCursor | null {
  if (!rawCursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(rawCursor, 'base64url').toString('utf8'),
    ) as { t?: unknown; y?: unknown; i?: unknown };
    if (
      typeof parsed.t !== 'string' ||
      typeof parsed.y !== 'string' ||
      typeof parsed.i !== 'string' ||
      !TYPE_SET.has(parsed.y)
    ) {
      throw new BadRequestException('Invalid activity cursor');
    }
    const occurredAt = new Date(parsed.t);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException('Invalid activity cursor');
    }
    return {
      occurredAt,
      type: parsed.y as CustomerActivityType,
      id: parsed.i,
    };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('Invalid activity cursor');
  }
}

/**
 * Keyset filter for sorting `(occurred_at DESC, type DESC, id DESC)`.
 * Items from `adapterType` come after `cursor` iff:
 * - `adapterType > cursor.type`: `field < cursor.occurredAt`
 * - `adapterType === cursor.type`: `field < cursor.occurredAt OR (field === cursor.occurredAt AND id < cursor.id)`
 * - `adapterType < cursor.type`: `field <= cursor.occurredAt`
 */
export function buildActivityKeysetClause(
  field: string,
  adapterType: CustomerActivityType,
  cursor: CustomerActivityCursor | null,
): Record<string, unknown> | undefined {
  if (!cursor) {
    return undefined;
  }
  if (adapterType > cursor.type) {
    return { [field]: { lt: cursor.occurredAt } };
  }
  if (adapterType < cursor.type) {
    return { [field]: { lte: cursor.occurredAt } };
  }
  return {
    OR: [
      { [field]: { lt: cursor.occurredAt } },
      { [field]: cursor.occurredAt, id: { lt: cursor.id } },
    ],
  };
}

export function compareActivityItemsDesc(
  a: Pick<CustomerActivityItem, 'occurred_at' | 'type' | 'id'>,
  b: Pick<CustomerActivityItem, 'occurred_at' | 'type' | 'id'>,
): number {
  const timeDiff =
    new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }
  if (a.type !== b.type) {
    return b.type.localeCompare(a.type);
  }
  return b.id.localeCompare(a.id);
}
