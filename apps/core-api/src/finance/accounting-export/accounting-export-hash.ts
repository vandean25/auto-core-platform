import { createHash } from 'node:crypto';
import type { AccountingExportManifestDocument } from './accounting-export.types.js';

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    const elements = value.map(canonicalize);
    return `[${elements.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashAccountingExportRequest(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex');
}

export function computePreviewHash(input: {
  legalEntityId: string;
  dateFrom: string;
  dateTo: string;
  profileVersion: number;
  siteIds: string[];
  documents: AccountingExportManifestDocument[];
}): string {
  const payload = {
    legalEntityId: input.legalEntityId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    profileVersion: input.profileVersion,
    siteIds: [...input.siteIds].sort(),
    documents: [...input.documents]
      .sort((left, right) => {
        if (left.date !== right.date) {
          return left.date < right.date ? -1 : 1;
        }
        if (left.kind !== right.kind) {
          return left.kind < right.kind ? -1 : 1;
        }
        if ((left.number ?? '') !== (right.number ?? '')) {
          return (left.number ?? '') < (right.number ?? '') ? -1 : 1;
        }
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      })
      .map((document) => ({
        id: document.id,
        kind: document.kind,
        snapshotHash: document.snapshotHash,
        lineIds: [...document.lineIds].sort(),
      })),
  };

  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

export function computeSnapshotHash(snapshot: unknown): string {
  return createHash('sha256').update(canonicalize(snapshot)).digest('hex');
}
