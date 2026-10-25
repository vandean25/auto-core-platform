import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ImportWorkerPhase } from './import-job.worker-state.js';

export type ImportTaskPayload = {
  tenantId: string;
  jobId: string;
  phase: ImportWorkerPhase;
};

export type SignedImportTaskPayload = ImportTaskPayload & {
  signature: string;
};

function signPayload(payload: ImportTaskPayload, secret: string): string {
  const body = `${payload.tenantId}:${payload.jobId}:${payload.phase}`;
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function signImportTaskPayload(
  payload: ImportTaskPayload,
  secret: string,
): SignedImportTaskPayload {
  return { ...payload, signature: signPayload(payload, secret) };
}

export function verifyImportTaskPayload(
  payload: SignedImportTaskPayload,
  secret: string,
): ImportTaskPayload {
  const expected = signPayload(payload, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(payload.signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid import task signature');
  }
  return {
    tenantId: payload.tenantId,
    jobId: payload.jobId,
    phase: payload.phase,
  };
}
