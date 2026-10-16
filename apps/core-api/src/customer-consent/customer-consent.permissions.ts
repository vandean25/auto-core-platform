import type {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  CustomerConsentStatus,
} from '@prisma/client';
import {
  isMarketingPurpose,
  isTransactionalPurpose,
} from './customer-consent.purposes.js';

export type ContactPermissionReason =
  | 'ALLOWED'
  | 'MARKETING_PERMISSION_MISSING'
  | 'CONTACT_WITHDRAWN'
  | 'PROCESSING_RESTRICTED'
  | 'NO_CONTACT_POINT'
  | 'SOFT_OPT_IN_INCOMPLETE';

export type ContactPermissionResult = {
  allowed: boolean;
  reason: ContactPermissionReason;
};

export type SoftOptInEvidence = {
  obtained_with_sale?: boolean;
  own_similar_products?: boolean;
  refusal_opportunity_at_collection?: boolean;
  no_prior_refusal?: boolean;
  own_similar_message_assessment?: boolean;
};

export type LedgerEventSlice = {
  purpose: CustomerConsentPurpose;
  channel: CustomerConsentChannel;
  status: CustomerConsentStatus;
  sequence: number;
  evidence?: SoftOptInEvidence | null;
};

export type TransactionalContactProjection = {
  orderEmailConfirmed?: boolean;
  orderSmsConfirmed?: boolean;
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

function softOptInFactsComplete(
  evidence: SoftOptInEvidence | null | undefined,
): boolean {
  if (!evidence) {
    return false;
  }
  return (
    evidence.obtained_with_sale === true &&
    evidence.own_similar_products === true &&
    evidence.refusal_opportunity_at_collection === true &&
    evidence.no_prior_refusal === true &&
    evidence.own_similar_message_assessment === true
  );
}

function statusAllowsMarketing(
  status: CustomerConsentStatus,
  evidence: SoftOptInEvidence | null | undefined,
): boolean {
  if (status === 'REVOKED') {
    return false;
  }
  if (status === 'GRANTED') {
    return true;
  }
  if (status === 'SOFT_OPT_IN') {
    return softOptInFactsComplete(evidence);
  }
  return false;
}

function transactionalAllowedWithoutLedger(
  purpose: CustomerConsentPurpose,
  channel: CustomerConsentChannel,
  projection: TransactionalContactProjection | undefined,
): boolean {
  if (!projection) {
    return false;
  }
  if (purpose === 'ORDER_COMMUNICATION' && channel === 'EMAIL') {
    return projection.orderEmailConfirmed === true;
  }
  if (purpose === 'ORDER_COMMUNICATION' && channel === 'SMS') {
    return projection.orderSmsConfirmed === true;
  }
  return false;
}

export function canContact(params: {
  purpose: CustomerConsentPurpose;
  channel: CustomerConsentChannel;
  events: LedgerEventSlice[];
  processingRestricted?: boolean;
  transactionalProjection?: TransactionalContactProjection;
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
    if (
      isTransactionalPurpose(params.purpose) &&
      transactionalAllowedWithoutLedger(
        params.purpose,
        params.channel,
        params.transactionalProjection,
      )
    ) {
      return { allowed: true, reason: 'ALLOWED' };
    }
    return {
      allowed: false,
      reason: isMarketingPurpose(params.purpose)
        ? 'MARKETING_PERMISSION_MISSING'
        : 'NO_CONTACT_POINT',
    };
  }

  if (latest.status === 'REVOKED') {
    return { allowed: false, reason: 'CONTACT_WITHDRAWN' };
  }

  if (isMarketingPurpose(params.purpose)) {
    if (!statusAllowsMarketing(latest.status, latest.evidence)) {
      return {
        allowed: false,
        reason:
          latest.status === 'SOFT_OPT_IN'
            ? 'SOFT_OPT_IN_INCOMPLETE'
            : 'MARKETING_PERMISSION_MISSING',
      };
    }
    return { allowed: true, reason: 'ALLOWED' };
  }

  if (latest.status === 'GRANTED' || latest.status === 'SOFT_OPT_IN') {
    return { allowed: true, reason: 'ALLOWED' };
  }

  return { allowed: false, reason: 'CONTACT_WITHDRAWN' };
}
