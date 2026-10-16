import type { CustomerConsentPurpose } from '@prisma/client';

export const MARKETING_CONSENT_PURPOSES: CustomerConsentPurpose[] = [
  'PICKERL_REMINDER',
  'SERVICE_REMINDER',
  'REVIEW_REQUEST',
  'SEASONAL_OFFERS',
  'NEWSLETTER',
];

export const TRANSACTIONAL_CONSENT_PURPOSES: CustomerConsentPurpose[] = [
  'ORDER_COMMUNICATION',
  'INVOICE_DELIVERY',
];

export const ALL_CONSENT_PURPOSES: CustomerConsentPurpose[] = [
  ...TRANSACTIONAL_CONSENT_PURPOSES,
  ...MARKETING_CONSENT_PURPOSES,
];

export function isMarketingPurpose(purpose: CustomerConsentPurpose): boolean {
  return MARKETING_CONSENT_PURPOSES.includes(purpose);
}

export function isTransactionalPurpose(
  purpose: CustomerConsentPurpose,
): boolean {
  return TRANSACTIONAL_CONSENT_PURPOSES.includes(purpose);
}
