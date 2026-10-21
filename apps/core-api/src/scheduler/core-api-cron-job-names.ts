/** Stable Nest `@Cron({ name })` values for core-api scheduled workers (AUT-611). */
export const CORE_API_CRON_JOB_NAMES = [
  'autoscout24-dms-deactivation-retry',
  'customer-consent-proof-purge',
  'document-branding-extraction-recovery',
  'document-branding-upload-recovery',
  'domain-event-consumer-recovery',
  'hr-shift-close',
  'import-job-row-purge',
  'landing-demo-access-cleanup',
  'mechanic-shift-close',
  'notification-outbox-recovery',
  'notification-outbox-body-purge',
  'registration-intake-byte-purge',
  'registration-intake-expiry',
  'workshop-check-in-orphan-upload-cleanup',
] as const;
