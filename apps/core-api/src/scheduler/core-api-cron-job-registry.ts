import type { Type } from '@nestjs/common';
import { Autoscout24DmsDeactivationRetryService } from '../vehicle/listing-export/autoscout24-dms/autoscout24-dms-deactivation-retry.service.js';
import { CustomerConsentRetentionService } from '../customer-consent/customer-consent-retention.service.js';
import { DocumentBrandingExtractionRecoveryService } from '../document-branding/document-branding-extraction-recovery.service.js';
import { DocumentBrandingUploadRecoveryRunner } from '../document-branding/document-branding-upload-recovery.runner.js';
import { DomainEventConsumerRecoveryService } from '../domain-event-consumer/domain-event-consumer-recovery.service.js';
import { HrAttendanceSchedulerService } from '../hr/hr-attendance-scheduler.service.js';
import { ImportRetentionService } from '../import/import-retention.service.js';
import { LandingDemoAccessCleanupService } from '../landing-demo-access/landing-demo-access.cleanup.service.js';
import { MechanicSchedulerService } from '../mechanic/mechanic-scheduler.service.js';
import { NotificationOutboxRecoveryService } from '../notifications/notification-outbox-recovery.service.js';
import { NotificationOutboxRetentionService } from '../notifications/notification-outbox-retention.service.js';
import { RegistrationIntakeBytePurgeService } from '../registration-intake/registration-intake-byte-purge.service.js';
import { RegistrationIntakeExpiryService } from '../registration-intake/registration-intake-expiry.service.js';
import { WorkshopCheckInOrphanUploadCleanupService } from '../workshop/workshop-check-in-orphan-upload-cleanup.service.js';
import { CORE_API_CRON_JOB_NAMES } from './core-api-cron-job-names.js';
import type { CoreApiCronJobName } from './core-api-cron-job-name.js';
import type { CoreApiCronJobRunner } from './core-api-cron-job-runner.js';

export const CORE_API_CRON_JOB_RUNNER_TYPES = {
  'autoscout24-dms-deactivation-retry': Autoscout24DmsDeactivationRetryService,
  'customer-consent-proof-purge': CustomerConsentRetentionService,
  'document-branding-extraction-recovery':
    DocumentBrandingExtractionRecoveryService,
  'document-branding-upload-recovery': DocumentBrandingUploadRecoveryRunner,
  'domain-event-consumer-recovery': DomainEventConsumerRecoveryService,
  'hr-shift-close': HrAttendanceSchedulerService,
  'import-job-row-purge': ImportRetentionService,
  'landing-demo-access-cleanup': LandingDemoAccessCleanupService,
  'mechanic-shift-close': MechanicSchedulerService,
  'notification-outbox-recovery': NotificationOutboxRecoveryService,
  'notification-outbox-body-purge': NotificationOutboxRetentionService,
  'registration-intake-byte-purge': RegistrationIntakeBytePurgeService,
  'registration-intake-expiry': RegistrationIntakeExpiryService,
  'workshop-check-in-orphan-upload-cleanup':
    WorkshopCheckInOrphanUploadCleanupService,
} satisfies Record<CoreApiCronJobName, Type<CoreApiCronJobRunner>>;

function assertCronJobRegistryExhaustive(): void {
  for (const name of CORE_API_CRON_JOB_NAMES) {
    if (!CORE_API_CRON_JOB_RUNNER_TYPES[name]) {
      throw new Error(`Missing core-api cron runner for "${name}"`);
    }
  }
}

assertCronJobRegistryExhaustive();
