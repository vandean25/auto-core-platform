import { createHash } from 'node:crypto';
import { CustomerNoteRetentionClass } from '@prisma/client';

export function computeCustomerNoteRetainUntil(params: {
  retentionClass: CustomerNoteRetentionClass;
  now: Date;
  lastCustomerActivityAt?: Date | null;
  orderClosedAt?: Date | null;
}): Date {
  if (params.retentionClass === CustomerNoteRetentionClass.CLAIMS_3Y) {
    const base = params.orderClosedAt ?? params.now;
    const endYear = base.getUTCFullYear() + 3;
    return new Date(Date.UTC(endYear, 11, 31, 23, 59, 59, 999));
  }

  const baseMs = Math.max(
    params.now.getTime(),
    params.lastCustomerActivityAt?.getTime() ?? 0,
  );
  const base = new Date(baseMs);
  const target = new Date(base);
  target.setUTCFullYear(target.getUTCFullYear() + 3);
  return target;
}

export function hashCustomerNoteBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function isNoteProtectedFromErasure(note: {
  legal_hold: boolean;
  retention_class: CustomerNoteRetentionClass;
}): boolean {
  return (
    note.legal_hold ||
    note.retention_class === CustomerNoteRetentionClass.CLAIMS_3Y
  );
}
