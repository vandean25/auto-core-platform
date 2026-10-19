import { Prisma, WorkshopEstimateStatus } from '@prisma/client';
import { localDateStartUtc } from './workshop-kpi-reports.math.js';

export function nextIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function siteLocalSentRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): { gte: Date; lt: Date } | null {
  if (!from || !to) {
    return null;
  }
  return {
    gte: localDateStartUtc(from, timeZone),
    lt: localDateStartUtc(nextIsoDate(to), timeZone),
  };
}

export type EstimateKeysetCursor = {
  sent_at: string | null;
  id: string;
};

export function encodeEstimateKeysetCursor(row: {
  sent_at: Date | null;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      sent_at: row.sent_at ? row.sent_at.toISOString() : null,
      id: row.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeEstimateKeysetCursor(
  cursor: string,
): EstimateKeysetCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as EstimateKeysetCursor;
    if (typeof parsed.id !== 'string') {
      return null;
    }
    if (parsed.sent_at !== null && typeof parsed.sent_at !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function effectiveStatusWhere(
  status: WorkshopEstimateStatus,
  now: Date,
): Prisma.WorkshopEstimateVersionWhereInput {
  if (status === WorkshopEstimateStatus.EXPIRED) {
    return {
      OR: [
        { status: WorkshopEstimateStatus.EXPIRED },
        {
          status: WorkshopEstimateStatus.SENT,
          valid_until: { lt: now },
        },
      ],
    };
  }
  if (status === WorkshopEstimateStatus.SENT) {
    return {
      status: WorkshopEstimateStatus.SENT,
      OR: [{ valid_until: null }, { valid_until: { gte: now } }],
    };
  }
  return { status };
}

export function keysetAfterCursor(
  cursor: EstimateKeysetCursor,
): Prisma.WorkshopEstimateVersionWhereInput {
  const sentAt = cursor.sent_at === null ? null : new Date(cursor.sent_at);
  if (sentAt === null) {
    return {
      OR: [{ sent_at: null, id: { lt: cursor.id } }],
    };
  }
  return {
    OR: [
      { sent_at: { lt: sentAt } },
      { sent_at: sentAt, id: { lt: cursor.id } },
      { sent_at: null },
    ],
  };
}
