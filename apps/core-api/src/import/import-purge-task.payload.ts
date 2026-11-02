import { createHmac, timingSafeEqual } from 'node:crypto';

export type ImportPurgeTaskPayload = {
  runId: string;
  sequence: number;
};

export type SignedImportPurgeTaskPayload = ImportPurgeTaskPayload & {
  signature: string;
};

function signPayload(payload: ImportPurgeTaskPayload, secret: string): string {
  const body = `row-purge:${payload.runId}:${payload.sequence}`;
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function signImportPurgeTaskPayload(
  payload: ImportPurgeTaskPayload,
  secret: string,
): SignedImportPurgeTaskPayload {
  return { ...payload, signature: signPayload(payload, secret) };
}

export function verifyImportPurgeTaskPayload(
  payload: SignedImportPurgeTaskPayload,
  secret: string,
): ImportPurgeTaskPayload {
  if (
    !payload ||
    typeof payload.runId !== 'string' ||
    !Number.isInteger(payload.sequence) ||
    payload.sequence < 0 ||
    typeof payload.signature !== 'string'
  ) {
    throw new Error('Invalid import purge task payload structure');
  }

  const expected = signPayload(
    { runId: payload.runId, sequence: payload.sequence },
    secret,
  );
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(payload.signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid import purge task signature');
  }
  return {
    runId: payload.runId,
    sequence: payload.sequence,
  };
}
