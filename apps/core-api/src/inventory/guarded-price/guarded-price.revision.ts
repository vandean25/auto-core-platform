import { guardedRequestInvalid } from './guarded-price.errors.js';
import { catalogItemRevisionToJsonInteger } from '../catalog-item-revision-json.util.js';

export function parseExpectedRevision(value: unknown): number {
  if (value === undefined) {
    guardedRequestInvalid('expectedRevision is required for guarded requests.');
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    guardedRequestInvalid('expectedRevision must be a safe JSON integer.');
  }
  if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
    guardedRequestInvalid(
      'expectedRevision is outside the safe integer range.',
    );
  }
  return value;
}

export function revisionFromDb(revision: bigint): number {
  return catalogItemRevisionToJsonInteger(revision);
}

export function revisionToDb(revision: number): bigint {
  return BigInt(revision);
}
