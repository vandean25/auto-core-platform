import { describe, expect, it } from '@jest/globals';
import {
  signImportPurgeTaskPayload,
  verifyImportPurgeTaskPayload,
  type ImportPurgeTaskPayload,
} from './import-purge-task.payload.js';

describe('ImportPurgeTaskPayload', () => {
  const secret = 'super-secret-worker-key-12345';
  const payload: ImportPurgeTaskPayload = {
    runId: '123e4567-e89b-12d3-a456-426614174000',
    sequence: 0,
  };

  it('signs and verifies payload successfully with matching secret', () => {
    const signed = signImportPurgeTaskPayload(payload, secret);
    expect(signed.signature).toBeDefined();
    expect(typeof signed.signature).toBe('string');

    const verified = verifyImportPurgeTaskPayload(signed, secret);
    expect(verified).toEqual(payload);
  });

  it('throws error when secret does not match', () => {
    const signed = signImportPurgeTaskPayload(payload, secret);
    expect(() =>
      verifyImportPurgeTaskPayload(signed, 'wrong-secret'),
    ).toThrow('Invalid import purge task signature');
  });

  it('throws error when sequence or runId is tampered with', () => {
    const signed = signImportPurgeTaskPayload(payload, secret);
    const tampered = { ...signed, sequence: 1 };
    expect(() => verifyImportPurgeTaskPayload(tampered, secret)).toThrow(
      'Invalid import purge task signature',
    );
  });
});
