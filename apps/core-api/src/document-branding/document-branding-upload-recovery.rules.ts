import type { DocumentBrandAsset } from '@prisma/client';

export const RECOVERY_LOG_CONTEXT = 'DocumentBrandingUploadRecoveryService';
export const INITIAL_DISPATCH_GRACE_MS = 60 * 1000;
export const DISPATCH_RECOVERY_GRACE_MS = 11 * 60 * 1000;

const MAX_VALIDATION_ATTEMPTS = 3;
const QUARANTINE_EXPIRY_MS = 24 * 60 * 60 * 1000;
const DELETABLE_STATES = ['READY', 'QUARANTINED', 'REJECTED'];

export type ExpiredAssetRef = {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
};

type GenerationRefs = Pick<
  DocumentBrandAsset,
  | 'bucket'
  | 'object_key'
  | 'object_generation'
  | 'quarantine_bucket'
  | 'quarantine_object_key'
  | 'quarantine_object_generation'
  | 'preview_bucket'
  | 'preview_object_key'
  | 'preview_object_generation'
>;

export function pendingValidationWhere(now: Date) {
  const staleBefore = new Date(now.getTime() - INITIAL_DISPATCH_GRACE_MS);
  const dispatchedStaleBefore = new Date(
    now.getTime() - DISPATCH_RECOVERY_GRACE_MS,
  );
  return {
    state: 'QUARANTINED' as const,
    validation_attempt_count: { lt: MAX_VALIDATION_ATTEMPTS },
    OR: [
      { validation_lease_until: { lt: now } },
      {
        validation_lease_until: null,
        OR: [
          { validation_dispatched_at: null, createdAt: { lt: staleBefore } },
          { validation_dispatched_at: { lt: dispatchedStaleBefore } },
        ],
      },
    ],
  };
}

export function exhaustedQuarantineUpdate(now: Date) {
  return {
    where: {
      state: 'QUARANTINED' as const,
      validation_attempt_count: { gte: MAX_VALIDATION_ATTEMPTS },
      validation_lease_until: { lt: now },
    },
    data: {
      state: 'REJECTED' as const,
      failure_code: 'VALIDATION_RETRIES_EXHAUSTED',
      expires_at: new Date(now.getTime() + QUARANTINE_EXPIRY_MS),
      validation_lease_until: null,
    },
  };
}

export function isDeletionDue(
  current: Pick<DocumentBrandAsset, 'state' | 'expires_at'>,
  now: Date,
): boolean {
  if (current.state === 'DELETED') return false;
  if (current.state === 'DELETING') return true;
  return (
    !!current.expires_at &&
    current.expires_at <= now &&
    DELETABLE_STATES.includes(current.state)
  );
}

export function toGenerationTarget(current: GenerationRefs) {
  return {
    bucket: current.bucket,
    object_key: current.object_key,
    object_generation: current.object_generation,
    quarantine_bucket: current.quarantine_bucket,
    quarantine_object_key: current.quarantine_object_key,
    quarantine_object_generation: current.quarantine_object_generation,
    preview_bucket: current.preview_bucket,
    preview_object_key: current.preview_object_key,
    preview_object_generation: current.preview_object_generation,
  };
}

export function safeError(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
