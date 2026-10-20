import { createHash } from 'node:crypto';
import { maskMatchEmail, maskMatchPhone } from './customer-match.util.js';
import type { CustomerProposeAddress } from './customer-propose.schema.js';

/** The customer fields a proposal may write, as submitted. */
export type CustomerProposalFields = {
  customer_type?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  email?: string;
  phone?: string;
  vat_id?: string;
  address?: CustomerProposeAddress;
  preferred_language?: string;
};

/** The fields a create proposal carries; all of them were submitted. */
export type CustomerCreateFields = CustomerProposalFields & {
  customer_type: string;
  first_name: string;
  last_name: string;
};

/** The duplicate check a proposal was built on. */
export type CustomerDuplicateCheck = {
  digest: string;
  candidate_ids: string[];
};

export type CustomerCreateProposalPayload = {
  action: 'customer.create';
  idempotency_key: string;
  fields: CustomerCreateFields;
  duplicate_check: CustomerDuplicateCheck;
};

export type CustomerUpdateProposalPayload = {
  action: 'customer.update';
  idempotency_key: string;
  customer_id: string;
  reason: string;
  changes: CustomerProposalFields;
  before_digest: string;
  duplicate_check: CustomerDuplicateCheck;
};

export type CustomerProposalPayload =
  CustomerCreateProposalPayload | CustomerUpdateProposalPayload;

/** One field of the proposal diff, with masked values only. */
export type CustomerProposalDiffEntry = {
  field: string;
  before_masked: string | null;
  after_masked: string | null;
};

const FIELD_KEYS = [
  'customer_type',
  'first_name',
  'last_name',
  'company_name',
  'email',
  'phone',
  'vat_id',
  'preferred_language',
] as const;

const ADDRESS_KEYS = ['street', 'zip', 'city', 'country'] as const;

const MASKED_ADDRESS_VALUE = '***';

/** Keeps only the submitted fields; nothing else is stored with a proposal. */
export function pickSubmittedFields(
  source: Record<string, unknown>,
): CustomerProposalFields {
  const fields: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    if (source[key] !== undefined) {
      fields[key] = source[key];
    }
  }
  const address = source.address;
  if (address && typeof address === 'object' && !Array.isArray(address)) {
    const addressRecord = address as Record<string, unknown>;
    const picked: Record<string, unknown> = {};
    for (const key of ADDRESS_KEYS) {
      if (addressRecord[key] !== undefined) {
        picked[key] = addressRecord[key];
      }
    }
    if (Object.keys(picked).length > 0) {
      fields.address = picked;
    }
  }
  return fields;
}

/** A stable JSON text of a value, used for digests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

/** A digest of a value; a proposal stores digests, not the values they cover. */
export function digestOf(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

/** The flat field list of a proposal, with the address split into single fields. */
export function flattenProposalFields(
  fields: CustomerProposalFields,
): Array<{ field: string; value: unknown }> {
  const flat: Array<{ field: string; value: unknown }> = [];
  for (const key of FIELD_KEYS) {
    if (fields[key] !== undefined) {
      flat.push({ field: key, value: fields[key] });
    }
  }
  const address = fields.address;
  if (address) {
    for (const key of ADDRESS_KEYS) {
      if (address[key] !== undefined) {
        flat.push({ field: `address.${key}`, value: address[key] });
      }
    }
  }
  return flat;
}

/** The masked value of a single field. */
export function maskProposalValue(
  field: string,
  value: unknown,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = typeof value === 'string' ? value : '';
  if (field === 'email') {
    return maskMatchEmail(text);
  }
  if (field === 'phone') {
    return maskMatchPhone(text);
  }
  if (field.startsWith('address.')) {
    return MASKED_ADDRESS_VALUE;
  }
  return text;
}

/** The diff between the current and the proposed customer fields, masked. */
export function buildProposalDiff(
  before: CustomerProposalFields,
  after: CustomerProposalFields,
): CustomerProposalDiffEntry[] {
  const beforeFlat = new Map(
    flattenProposalFields(before).map((entry) => [entry.field, entry.value]),
  );
  const diff: CustomerProposalDiffEntry[] = [];
  for (const entry of flattenProposalFields(after)) {
    const beforeMasked = maskProposalValue(
      entry.field,
      beforeFlat.get(entry.field),
    );
    const afterMasked = maskProposalValue(entry.field, entry.value);
    if (beforeMasked === afterMasked) {
      continue;
    }
    diff.push({
      field: entry.field,
      before_masked: beforeMasked,
      after_masked: afterMasked,
    });
  }
  return diff;
}

/** A masked copy of a proposal payload, for logs and tool results. */
export function maskProposalPayload(
  payload: CustomerProposalPayload,
): Record<string, unknown> {
  const fields =
    payload.action === 'customer.create' ? payload.fields : payload.changes;
  const base: Record<string, unknown> = {
    action: payload.action,
    idempotency_key: payload.idempotency_key,
    duplicate_check: payload.duplicate_check,
  };
  if (payload.action === 'customer.create') {
    return { ...base, fields: maskFields(fields) };
  }
  return {
    ...base,
    customer_id: payload.customer_id,
    reason: payload.reason,
    changes: maskFields(fields),
    before_digest: payload.before_digest,
  };
}

/** A masked copy of the raw tool arguments, for the action log. */
export function maskProposalArgs(args: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return args;
  }
  const record = { ...(args as Record<string, unknown>) };
  if (typeof record.email === 'string') {
    record.email = maskMatchEmail(record.email);
  }
  if (typeof record.phone === 'string') {
    record.phone = maskMatchPhone(record.phone);
  }
  if (record.address && typeof record.address === 'object') {
    record.address = maskAddress(record.address);
  }
  if (record.changes && typeof record.changes === 'object') {
    record.changes = maskProposalArgs(record.changes);
  }
  return record;
}

function maskAddress(address: unknown): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    address as Record<string, unknown>,
  )) {
    masked[key] = value === undefined ? value : MASKED_ADDRESS_VALUE;
  }
  return masked;
}

function maskFields(fields: CustomerProposalFields): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const entry of flattenProposalFields(fields)) {
    if (entry.field.startsWith('address.')) {
      continue;
    }
    masked[entry.field] = maskProposalValue(entry.field, entry.value);
  }
  const address = fields.address;
  if (address) {
    const maskedAddress: Record<string, unknown> = {};
    for (const key of ADDRESS_KEYS) {
      if (address[key] !== undefined) {
        maskedAddress[key] = MASKED_ADDRESS_VALUE;
      }
    }
    if (Object.keys(maskedAddress).length > 0) {
      masked.address = maskedAddress;
    }
  }
  return masked;
}
