import {
  isValidAtUid,
  isValidDeVatId,
} from '../site/legal-entity-seller.validation.js';
import { normalizeCustomerVatId } from '../customer/customer-vat-id.validation.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportRowIssue,
  NormalizedCustomerRow,
} from './import.types.js';
import { ImportRowAction } from '@prisma/client';

const CONSENT_COLUMN_KEYS = new Set([
  'consent',
  'marketing',
  'newsletter',
  'email_opt_in',
  'sms_opt_in',
  'werbung',
  'einwilligung',
]);

export type CustomerMatchContext = {
  mappingByExternalId: Map<string, string>;
  customerByEmail: Map<string, { id: string; record: Record<string, unknown> }>;
  customerById: Map<string, Record<string, unknown>>;
  duplicateNameKeys: Set<string>;
};

function cellValue(
  record: Record<string, string>,
  mapping: Record<string, string>,
  field: string,
): string {
  const column = mapping[field];
  if (!column) {
    return '';
  }
  return record[column]?.trim() ?? '';
}

function parseCustomerType(raw: string): 'PRIVATE' | 'COMPANY' {
  const normalized = raw.trim().toUpperCase();
  if (
    normalized === 'BUSINESS' ||
    normalized === 'COMPANY' ||
    normalized === 'FIRMA'
  ) {
    return 'COMPANY';
  }
  return 'PRIVATE';
}

function isEmpty(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

function formatComparable(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function customerNameKey(row: NormalizedCustomerRow): string {
  if (row.type === 'COMPANY' && row.company_name) {
    return `company:${row.company_name.trim().toLowerCase()}`;
  }
  return `person:${row.first_name.trim().toLowerCase()}|${row.last_name.trim().toLowerCase()}`;
}

function validateVatId(
  country: string | null,
  vatId: string | null,
  options: ImportJobOptions,
): {
  vatId: string | null;
  issues: ImportRowIssue[];
  warnings: ImportRowIssue[];
} {
  const issues: ImportRowIssue[] = [];
  if (!vatId) {
    return { vatId: null, issues, warnings: [] };
  }
  const countryIso = country?.trim().toUpperCase() ?? '';
  const validAt = isValidAtUid(vatId);
  const validDe = isValidDeVatId(vatId);
  const valid =
    countryIso === 'AT'
      ? validAt
      : countryIso === 'DE'
        ? validDe
        : validAt || validDe;

  if (
    !valid &&
    (countryIso === 'AT' || countryIso === 'DE' || countryIso === '')
  ) {
    const issue: ImportRowIssue = {
      code: 'CUSTOMER_VAT_ID_INVALID',
      message: 'vat_id is not a valid AT/DE VAT identifier format',
      field: 'vat_id',
    };
    if (options.invalid_vat_as_error) {
      issues.push(issue);
      return { vatId: null, issues, warnings: [] };
    }
    return {
      vatId: null,
      issues: [],
      warnings: [
        {
          ...issue,
          message: `${issue.message}; imported without UID`,
        },
      ],
    };
  }
  return { vatId, issues, warnings: [] };
}

export function normalizeCustomerRow(
  record: Record<string, string>,
  mapping: Record<string, string>,
  options: ImportJobOptions,
): {
  row: NormalizedCustomerRow | null;
  issues: ImportRowIssue[];
  warnings: ImportRowIssue[];
} {
  const issues: ImportRowIssue[] = [];
  const warnings: ImportRowIssue[] = [];

  for (const key of Object.keys(record)) {
    const normalizedKey = key.trim().toLowerCase();
    if (CONSENT_COLUMN_KEYS.has(normalizedKey)) {
      warnings.push({
        code: 'IMPORT_CONSENT_COLUMN_IGNORED',
        message: `Consent/marketing column "${key}" is ignored`,
        field: key,
      });
    }
  }

  const externalId = cellValue(record, mapping, 'external_id');
  if (!externalId) {
    issues.push({
      code: 'IMPORT_EXTERNAL_ID_REQUIRED',
      message: 'external_id is required',
      field: 'external_id',
    });
    return { row: null, issues, warnings };
  }

  const type = parseCustomerType(cellValue(record, mapping, 'type'));
  const companyName = cellValue(record, mapping, 'company_name') || null;
  let firstName = cellValue(record, mapping, 'first_name');
  let lastName = cellValue(record, mapping, 'last_name');

  if (type === 'COMPANY' && isEmpty(lastName) && companyName) {
    lastName = companyName;
  }
  if (isEmpty(firstName)) {
    firstName = type === 'COMPANY' && companyName ? companyName : '-';
  }
  if (isEmpty(lastName)) {
    lastName = '-';
  }

  const emailRaw = cellValue(record, mapping, 'email');
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  const vatRaw = normalizeCustomerVatId(cellValue(record, mapping, 'vat_id'));
  const country = cellValue(record, mapping, 'address_country') || 'AT';

  const vatResult = validateVatId(country, vatRaw, options);
  issues.push(...vatResult.issues);
  warnings.push(...vatResult.warnings);

  const row: NormalizedCustomerRow = {
    external_id: externalId,
    type,
    company_name: companyName,
    first_name: firstName,
    last_name: lastName,
    email,
    phone: cellValue(record, mapping, 'phone') || null,
    vat_id: vatResult.vatId,
    address_street: cellValue(record, mapping, 'address_street') || null,
    address_zip: cellValue(record, mapping, 'address_zip') || null,
    address_city: cellValue(record, mapping, 'address_city') || null,
    address_country: country || null,
  };

  if (issues.length > 0) {
    return { row: null, issues, warnings };
  }

  return { row, issues, warnings };
}

function buildCustomerPayload(row: NormalizedCustomerRow) {
  return {
    type: row.type,
    company_name: row.company_name,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    vat_id: row.vat_id,
    address_street: row.address_street,
    address_zip: row.address_zip,
    address_city: row.address_city,
    address_country: row.address_country,
  };
}

function recordsEqual(
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
  fillEmptyOnly: boolean,
): boolean {
  for (const [key, value] of Object.entries(desired)) {
    const current = existing[key];
    if (fillEmptyOnly) {
      if (
        isEmpty(formatComparable(current)) &&
        !isEmpty(formatComparable(value))
      ) {
        return false;
      }
      continue;
    }
    const normalizedCurrent = formatComparable(current);
    const normalizedDesired = formatComparable(value);
    if (normalizedCurrent !== normalizedDesired) {
      return false;
    }
  }
  return true;
}

export function planCustomerDryRunRow(
  rowNo: number,
  row: NormalizedCustomerRow,
  context: CustomerMatchContext,
  options: ImportJobOptions,
  warnings: ImportRowIssue[],
): DryRunRowResult {
  const payload = buildCustomerPayload(row);
  const mappingEntityId = context.mappingByExternalId.get(row.external_id);
  let entityId: string | null = mappingEntityId ?? null;
  let matchedBy: 'external_id' | 'email' | null = mappingEntityId
    ? 'external_id'
    : null;

  if (!entityId && row.email) {
    const emailMatch = context.customerByEmail.get(row.email);
    if (emailMatch) {
      entityId = emailMatch.id;
      matchedBy = 'email';
    }
  }

  const nameKey = customerNameKey(row);
  if (!entityId && context.duplicateNameKeys.has(nameKey)) {
    warnings.push({
      code: 'IMPORT_POSSIBLE_DUPLICATE',
      message: 'A row or existing record may be a duplicate by name',
    });
  }

  if (!entityId) {
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.CREATE,
      entity_id: null,
      errors: [],
      warnings,
      normalized: { ...payload, external_id: row.external_id },
    };
  }

  const existing =
    entityId !== null
      ? context.customerById.get(entityId)
      : matchedBy === 'email'
        ? context.customerByEmail.get(row.email!)?.record
        : undefined;

  const updateExisting = options.update_existing === true;
  if (!updateExisting) {
    if (existing && !recordsEqual(existing, payload, false)) {
      warnings.push({
        code: 'IMPORT_EXISTING_NOT_UPDATED',
        message: 'Existing customer matched but update_existing is false',
      });
    }
    return {
      row_no: rowNo,
      external_id: row.external_id,
      action: ImportRowAction.SKIP,
      entity_id: entityId,
      errors: [],
      warnings,
      normalized: { ...payload, external_id: row.external_id },
    };
  }

  if (existing) {
    const unchanged = recordsEqual(
      existing,
      payload,
      options.fill_empty_only === true,
    );
    if (unchanged) {
      return {
        row_no: rowNo,
        external_id: row.external_id,
        action: ImportRowAction.SKIP,
        entity_id: entityId,
        errors: [],
        warnings,
        normalized: { ...payload, external_id: row.external_id },
      };
    }
  }

  return {
    row_no: rowNo,
    external_id: row.external_id,
    action: ImportRowAction.UPDATE,
    entity_id: entityId,
    errors: [],
    warnings,
    normalized: { ...payload, external_id: row.external_id },
  };
}
