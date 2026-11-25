import { BadRequestException } from '@nestjs/common';
import type { PermissionId } from '../permissions/permission-catalogue.js';

export const SAVED_VIEW_MAX_NAME_LENGTH = 60;
export const SAVED_VIEW_MAX_HREF_LENGTH = 2000;
export const SAVED_VIEW_PER_LIST_LIMIT = 50;

export type SavedViewListEntry = {
  permission: PermissionId;
  extraParams?: readonly string[];
};

/**
 * Server-side allowlist mapping each list_path to its required read permission
 * and any list-specific query parameters beyond the standard DataTable params.
 */
export const SAVED_VIEW_LIST_REGISTRY: Readonly<
  Record<string, SavedViewListEntry>
> = {
  '/customers': { permission: 'customer.read' },
  '/sales-orders': { permission: 'sales.order.read' },
  '/sales/invoices': { permission: 'invoice.read' },
  '/workshop/orders': { permission: 'workshop.order.read' },
  '/workshop/pick-list': { permission: 'workshop.order.read' },
  '/workshop/estimates': {
    permission: 'workshop.estimate.read',
    extraParams: ['view'],
  },
  '/workshop/loaner-vehicles': {
    permission: 'loaner.vehicle.read',
    extraParams: ['vehicle'],
  },
  '/workshop/tyre-storage': { permission: 'tyre.set.read' },
  '/vehicles': { permission: 'vehicle.read' },
  '/vehicles/pickerl-due': {
    permission: 'vehicle.pickerl.read',
    extraParams: ['window', 'status'],
  },
  '/vehicles/gewaehrleistung-due': {
    permission: 'vehicle_stock.gewaehrleistung.read',
  },
  '/vehicle-stock': { permission: 'vehicle_stock.read' },
  '/vehicle-stock/reports': {
    permission: 'vehicle_stock.report.read',
    extraParams: ['bucket'],
  },
  '/inventory': { permission: 'stock.read' },
  '/stock-transfers': { permission: 'stock.transfer.read' },
  '/vendors': { permission: 'vendor.read' },
  '/purchase-orders': { permission: 'purchase.order.read' },
  '/purchase-bills': { permission: 'purchase.invoice.read' },
  '/finance/credit-notes': { permission: 'credit_note.read' },
  '/hr/employees': { permission: 'employee.read' },
  '/hr/leave': { permission: 'hr.leave.read' },
};

const COMMON_QUERY_PARAMS = new Set([
  'pageSize',
  'search',
  'sortField',
  'sortDirection',
  'cols',
  'density',
]);

const FILTER_PARAM_PATTERN = /^filter_[a-zA-Z0-9_.-]+$/;
const COLUMN_LIST_PATTERN = /^[a-zA-Z0-9_.-]+(?:,[a-zA-Z0-9_.-]+)*$/;

function invalidSavedView(message: string): BadRequestException {
  return new BadRequestException({
    code: 'SAVED_VIEW_INVALID',
    message,
  });
}

function validateLayoutParams(params: URLSearchParams): void {
  const cols = params.get('cols');
  if (
    cols !== null &&
    (params.getAll('cols').length > 1 || !COLUMN_LIST_PATTERN.test(cols))
  ) {
    throw invalidSavedView(
      'Saved view cols must be a comma-separated list of column IDs.',
    );
  }

  const density = params.get('density');
  if (
    density !== null &&
    (params.getAll('density').length > 1 ||
      (density !== 'compact' && density !== 'comfortable'))
  ) {
    throw invalidSavedView(
      'Saved view density must be compact or comfortable.',
    );
  }
}

export function getSavedViewListEntry(listPath: string): SavedViewListEntry {
  const entry = Object.hasOwn(SAVED_VIEW_LIST_REGISTRY, listPath)
    ? SAVED_VIEW_LIST_REGISTRY[listPath]
    : undefined;
  if (!entry) {
    throw invalidSavedView(`Unknown listPath "${listPath}".`);
  }
  return entry;
}

export function validateSavedViewName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed || trimmed.length > SAVED_VIEW_MAX_NAME_LENGTH) {
    throw invalidSavedView(
      `Saved view name must be between 1 and ${SAVED_VIEW_MAX_NAME_LENGTH} characters.`,
    );
  }
  return trimmed;
}

export function validateSavedViewHref(
  rawHref: string,
  listPath: string,
): string {
  const entry = getSavedViewListEntry(listPath);
  const trimmed = rawHref.trim();
  if (
    !trimmed ||
    trimmed.length > SAVED_VIEW_MAX_HREF_LENGTH ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\')
  ) {
    throw invalidSavedView('Saved view href must be a relative path.');
  }

  // Reject ASCII control characters.
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw invalidSavedView('Saved view href contains invalid characters.');
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, 'http://localhost');
  } catch {
    throw invalidSavedView('Saved view href is not a valid relative URL.');
  }

  if (parsed.origin !== 'http://localhost' || parsed.hash !== '') {
    throw invalidSavedView('Saved view href must be a relative path.');
  }

  if (parsed.pathname !== listPath) {
    throw invalidSavedView(
      `Saved view href pathname "${parsed.pathname}" must match listPath "${listPath}".`,
    );
  }

  const extra = new Set(entry.extraParams ?? []);
  for (const key of parsed.searchParams.keys()) {
    const allowed =
      COMMON_QUERY_PARAMS.has(key) ||
      FILTER_PARAM_PATTERN.test(key) ||
      extra.has(key);
    if (!allowed) {
      throw invalidSavedView(
        `Query parameter "${key}" is not allowed for "${listPath}".`,
      );
    }
  }

  validateLayoutParams(parsed.searchParams);
  return trimmed;
}

export function validateSavedViewInput(input: {
  listPath: string;
  name: string;
  href: string;
}): { listPath: string; name: string; href: string } {
  const name = validateSavedViewName(input.name);
  const href = validateSavedViewHref(input.href, input.listPath);
  return {
    listPath: input.listPath,
    name,
    href,
  };
}
