import { BadRequestException } from '@nestjs/common';
import {
  LIST_CURSOR_INVALID_CODE,
  LIST_CURSOR_VERSION,
  type ListCursorEndpointId,
} from './list-cursor.constants.js';

export type ListCursorPayload = {
  v: typeof LIST_CURSOR_VERSION;
  ep: ListCursorEndpointId;
  sort: string;
  dir: 'asc' | 'desc';
  fh: string;
  tid: string;
  sid: string;
  sv: string | number | boolean | null;
  id: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeListCursor(payload: ListCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeListCursor(encoded: string): ListCursorPayload | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as ListCursorPayload;
    if (parsed?.v !== LIST_CURSOR_VERSION) return null;
    if (typeof parsed.ep !== 'string') return null;
    if (typeof parsed.sort !== 'string' || parsed.sort.length === 0) {
      return null;
    }
    if (parsed.dir !== 'asc' && parsed.dir !== 'desc') return null;
    if (typeof parsed.fh !== 'string' || parsed.fh.length === 0) return null;
    if (typeof parsed.tid !== 'string' || !UUID_PATTERN.test(parsed.tid)) {
      return null;
    }
    if (typeof parsed.sid !== 'string') return null;
    if (
      parsed.sv !== null &&
      typeof parsed.sv !== 'string' &&
      typeof parsed.sv !== 'number' &&
      typeof parsed.sv !== 'boolean'
    ) {
      return null;
    }
    if (typeof parsed.id !== 'string' || !UUID_PATTERN.test(parsed.id)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type ListCursorBindingContext = {
  endpoint: ListCursorEndpointId;
  tenantId: string;
  siteId: string;
  filterHash: string;
  sortField: string;
  sortDirection: 'asc' | 'desc';
};

export function assertListCursorMatchesRequest(
  decoded: ListCursorPayload,
  context: ListCursorBindingContext,
): void {
  if (
    decoded.ep !== context.endpoint ||
    decoded.tid !== context.tenantId ||
    decoded.sid !== context.siteId ||
    decoded.fh !== context.filterHash ||
    decoded.sort !== context.sortField ||
    decoded.dir !== context.sortDirection
  ) {
    throw listCursorInvalidException();
  }
}

export function listCursorInvalidException(): BadRequestException {
  return new BadRequestException({
    code: LIST_CURSOR_INVALID_CODE,
    message: 'The list cursor is invalid or does not match this request.',
  });
}

export function parseListCursorParam(
  cursor: string | undefined,
  context: ListCursorBindingContext,
): ListCursorPayload | undefined {
  if (!cursor) {
    return undefined;
  }
  const decoded = decodeListCursor(cursor);
  if (!decoded) {
    throw listCursorInvalidException();
  }
  assertListCursorMatchesRequest(decoded, context);
  return decoded;
}

export function serializeSortValueForCursor(
  value: unknown,
): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

export function deserializeSortValueFromCursor(
  serialized: string | number | boolean | null,
  kind: 'string' | 'number' | 'int' | 'decimal' | 'date' | 'enum',
): unknown {
  if (serialized === null) {
    return null;
  }
  switch (kind) {
    case 'number':
      return typeof serialized === 'number' ? serialized : Number(serialized);
    case 'int':
      return typeof serialized === 'number'
        ? Math.trunc(serialized)
        : parseInt(String(serialized), 10);
    case 'decimal':
      return typeof serialized === 'number' ? serialized : String(serialized);
    case 'date':
      return new Date(String(serialized));
    case 'enum':
    case 'string':
    default:
      return String(serialized);
  }
}
