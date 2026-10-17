/** Internal notice consumer for committed KVA customer decisions (AUT-544). */
export const WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER =
  'workshop_estimate.decided.v1:internal_notice';

export const DOMAIN_EVENT_CONSUMER_LEASE_MS = 120_000;
export const DOMAIN_EVENT_CONSUMER_BATCH_SIZE = 25;

export const DOMAIN_EVENT_CONSUMER_OUTCOME = {
  notified: 'NOTIFIED',
  skipped: 'SKIPPED',
} as const;
