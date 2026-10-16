import type {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  CustomerConsentStatus,
} from '@prisma/client';

export type ContactPermissionReason =
  | 'ALLOWED'
  | 'MARKETING_PERMISSION_MISSING'
  | 'CONTACT_WITHDRAWN'
  | 'PROCESSING_RESTRICTED'
  | 'NO_CONTACT_POINT';

export type ContactPermissionResult = {
  allowed: boolean;
  reason: ContactPermissionReason;
};

export type LedgerEventSlice = {
  purpose: CustomerConsentPurpose;
  channel: CustomerConsentChannel;
  status: CustomerConsentStatus;
  sequence: number;
};

export function pickLatestLedgerEvent(
  events: LedgerEventSlice[],
  purpose: CustomerConsentPurpose,
  channel: CustomerConsentChannel,
): LedgerEventSlice | null {
  const scoped = events.filter(
    (event) => event.purpose === purpose && event.channel === channel,
  );
  if (scoped.length === 0) {
    return null;
  }
  return scoped.reduce((latest, event) =>
    event.sequence > latest.sequence ? event : latest,
  );
}

export function statusAllowsContact(
  purpose: CustomerConsentPurpose,
  status: CustomerConsentStatus | null,
): boolean {
  if (!status) {
    return false;
  }
  if (status === 'REVOKED') {
    return false;
  }
  if (purpose === 'MARKETING') {
    return status === 'GRANTED' || status === 'SOFT_OPT_IN';
  }
  return status === 'GRANTED' || status === 'SOFT_OPT_IN';
}

export function canContact(params: {
  purpose: CustomerConsentPurpose;
  channel: CustomerConsentChannel;
  events: LedgerEventSlice[];
  processingRestricted?: boolean;
}): ContactPermissionResult {
  if (params.processingRestricted) {
    return { allowed: false, reason: 'PROCESSING_RESTRICTED' };
  }

  const latest = pickLatestLedgerEvent(
    params.events,
    params.purpose,
    params.channel,
  );
  if (!latest) {
    return {
      allowed: false,
      reason:
        params.purpose === 'MARKETING'
          ? 'MARKETING_PERMISSION_MISSING'
          : 'NO_CONTACT_POINT',
    };
  }

  if (latest.status === 'REVOKED') {
    return { allowed: false, reason: 'CONTACT_WITHDRAWN' };
  }

  if (!statusAllowsContact(params.purpose, latest.status)) {
    return {
      allowed: false,
      reason:
        params.purpose === 'MARKETING'
          ? 'MARKETING_PERMISSION_MISSING'
          : 'CONTACT_WITHDRAWN',
    };
  }

  return { allowed: true, reason: 'ALLOWED' };
}
