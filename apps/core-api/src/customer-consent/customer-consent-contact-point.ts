import { createHash } from 'node:crypto';
import type { CustomerConsentChannel } from '@prisma/client';

export function normalizeContactAddress(
  channel: CustomerConsentChannel,
  raw: string,
): string {
  const trimmed = raw.trim();
  if (channel === 'EMAIL') {
    const at = trimmed.lastIndexOf('@');
    if (at <= 0) {
      return trimmed.toLowerCase();
    }
    const local = trimmed.slice(0, at);
    const domain = trimmed.slice(at + 1).toLowerCase();
    return `${local}@${domain}`;
  }
  return trimmed;
}

export function fingerprintContactAddress(
  channel: CustomerConsentChannel,
  normalized: string,
): string {
  return createHash('sha256')
    .update(`${channel}:${normalized}`, 'utf8')
    .digest('hex');
}
