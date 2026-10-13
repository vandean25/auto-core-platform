import {
  DISPATCH_RECOVERY_GRACE_MS,
  exhaustedQuarantineUpdate,
  INITIAL_DISPATCH_GRACE_MS,
  isDeletionDue,
  pendingValidationWhere,
  safeError,
  toGenerationTarget,
} from './document-branding-upload-recovery.rules.js';

describe('document branding upload recovery rules', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const past = new Date('2026-09-01T00:00:00Z');
  const future = new Date('2026-11-01T00:00:00Z');

  it('treats a deleting asset as due regardless of expiry, and never deletes a deleted one', () => {
    expect(isDeletionDue({ state: 'DELETING', expires_at: future }, now)).toBe(
      true,
    );
    expect(isDeletionDue({ state: 'DELETED', expires_at: past }, now)).toBe(
      false,
    );
  });

  it('deletes only expired assets in a deletable state', () => {
    expect(isDeletionDue({ state: 'READY', expires_at: past }, now)).toBe(true);
    expect(isDeletionDue({ state: 'REJECTED', expires_at: past }, now)).toBe(
      true,
    );
    expect(isDeletionDue({ state: 'READY', expires_at: future }, now)).toBe(
      false,
    );
    expect(isDeletionDue({ state: 'READY', expires_at: null }, now)).toBe(
      false,
    );
  });

  it('selects stalled quarantines by lease expiry or by the dispatch grace windows', () => {
    expect(pendingValidationWhere(now)).toEqual({
      state: 'QUARANTINED',
      validation_attempt_count: { lt: 3 },
      OR: [
        { validation_lease_until: { lt: now } },
        {
          validation_lease_until: null,
          OR: [
            {
              validation_dispatched_at: null,
              createdAt: {
                lt: new Date(now.getTime() - INITIAL_DISPATCH_GRACE_MS),
              },
            },
            {
              validation_dispatched_at: {
                lt: new Date(now.getTime() - DISPATCH_RECOVERY_GRACE_MS),
              },
            },
          ],
        },
      ],
    });
  });

  it('rejects quarantined uploads at the retry limit with a fixed failure code', () => {
    expect(exhaustedQuarantineUpdate(now).data).toEqual({
      state: 'REJECTED',
      failure_code: 'VALIDATION_RETRIES_EXHAUSTED',
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      validation_lease_until: null,
    });
  });

  it('maps every storage locator of an asset into one cleanup target', () => {
    expect(
      toGenerationTarget({
        bucket: 'b',
        object_key: 'o',
        object_generation: '1',
        quarantine_bucket: 'qb',
        quarantine_object_key: 'qo',
        quarantine_object_generation: '2',
        preview_bucket: 'pb',
        preview_object_key: 'po',
        preview_object_generation: '3',
      }),
    ).toEqual({
      bucket: 'b',
      object_key: 'o',
      object_generation: '1',
      quarantine_bucket: 'qb',
      quarantine_object_key: 'qo',
      quarantine_object_generation: '2',
      preview_bucket: 'pb',
      preview_object_key: 'po',
      preview_object_generation: '3',
    });
  });

  it('logs only the error class name, never its message', () => {
    expect(safeError(new TypeError('secret detail'))).toBe('TypeError');
    expect(safeError('plain')).toBe('unknown error');
  });
});
