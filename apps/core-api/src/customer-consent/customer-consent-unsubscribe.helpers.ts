import type {
  CustomerConsentChannel,
  CustomerConsentPurpose,
} from '@prisma/client';
import {
  pickLatestLedgerEvent,
  type LedgerEventSlice,
} from './customer-consent.permissions.js';
import { MARKETING_CONSENT_PURPOSES } from './customer-consent.purposes.js';

export function buildUnsubscribeIdempotencyKey(
  tokenHash: string,
  purpose: CustomerConsentPurpose,
  supersededSequence: number,
): string {
  return `unsubscribe:${tokenHash}:${purpose}:after-seq:${supersededSequence}`;
}

export function marketingPurposeNeedsUnsubscribe(
  events: LedgerEventSlice[],
  purpose: CustomerConsentPurpose,
  channel: CustomerConsentChannel,
): { needed: boolean; supersededSequence: number } {
  const latest = pickLatestLedgerEvent(events, purpose, channel);
  if (!latest || latest.status === 'REVOKED') {
    return { needed: false, supersededSequence: 0 };
  }
  return { needed: true, supersededSequence: latest.sequence };
}

export function anyMarketingPurposeNeedsUnsubscribe(
  events: LedgerEventSlice[],
  channel: CustomerConsentChannel,
): boolean {
  return MARKETING_CONSENT_PURPOSES.some(
    (purpose) =>
      marketingPurposeNeedsUnsubscribe(events, purpose, channel).needed,
  );
}
