import { createHash } from 'node:crypto';
import { isSingleLineText } from '../notifications/email/header-text.js';

export const DEMO_ACCESS_DURATION_DAYS = 14;
export const DEMO_MAGIC_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const DEMO_MUTATION_ALLOWED_EXACT = new Set([
  '/api/auth/switch-tenant',
  '/api/me/active-site',
]);

const DEMO_MUTATION_ALLOWED_PREFIXES = [
  '/api/customers',
  '/api/vehicles',
  '/api/workshop/orders',
  '/api/workshop/estimates',
  '/api/workshop/waiting-tasks',
  '/api/workshop/planner',
  '/api/workshop/capacity',
  '/api/workshop/loaner-vehicles',
  '/api/workshop/loaner-bookings',
  '/api/catalog',
  '/api/inventory',
  '/api/bays',
  '/api/mechanic',
  '/api/parts-reservations',
  '/api/parts-requisitions',
] as const;

const DEMO_MUTATION_BLOCKED_PREFIXES = [
  '/api/settings',
  '/api/platform-admin',
  '/api/platform/',
  '/api/tenant-members',
  '/api/tenant-api-keys',
  '/api/employees',
  '/api/sites',
  '/api/legal-entities',
  '/api/invoices',
  '/api/purchase-orders',
  '/api/purchase-invoices',
  '/api/purchase',
  '/api/finance',
  '/api/import',
  '/api/mcp',
  '/api/hr',
  '/api/agent-',
  '/api/notifications',
  '/api/accounting-exports',
  '/api/document-branding',
  '/api/vehicle-stock',
  '/api/vehicle-purchases',
  '/api/vehicle-sales',
  '/api/sales',
  '/api/vendors',
  '/api/credit-notes',
  '/api/margin-rules',
  '/api/voice-translation',
  '/api/audit-logs',
  '/api/decision-shadow-logs',
  '/api/workshop/settings',
  '/api/workshop/holidays',
] as const;

const DEMO_MUTATION_BLOCKED_SUBSTRINGS = [
  '/send',
  '/finalize',
  '/pay',
  '/issue',
  '/invite',
  '/create-invoice',
  '/create-purchase-order',
  '/tyre-sets/settings',
  '/labor/operations',
  '/stock-transfers/',
  '/approve',
] as const;

export function hashClientIp(ip: string | null | undefined): string | null {
  const normalized = ip?.trim();
  if (!normalized) {
    return null;
  }
  return createHash('sha256').update(normalized).digest('hex');
}

export function hashDemoEmail(email: string): string {
  return createHash('sha256').update(normalizeDemoEmail(email)).digest('hex');
}

export function normalizeDemoEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isLandingDemoHoneypotTriggered(
  website?: string | null,
): boolean {
  return Boolean(website && website.trim() !== '');
}

export function isLandingDemoSingleLineText(value: string): boolean {
  return isSingleLineText(value);
}

function decodeRequestPathSegment(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function normalizeDemoRequestPath(path: string): string {
  const withoutQuery = path.split('?')[0] ?? '';
  const decoded = decodeRequestPathSegment(withoutQuery).toLowerCase();
  return decoded.startsWith('/api/')
    ? decoded
    : `/api${decoded.startsWith('/') ? '' : '/'}${decoded}`;
}

function isDemoMutationPathAllowed(normalizedPath: string): boolean {
  for (const prefix of DEMO_MUTATION_BLOCKED_PREFIXES) {
    if (normalizedPath.startsWith(prefix)) {
      return false;
    }
  }

  for (const fragment of DEMO_MUTATION_BLOCKED_SUBSTRINGS) {
    if (normalizedPath.includes(fragment)) {
      return false;
    }
  }

  if (DEMO_MUTATION_ALLOWED_EXACT.has(normalizedPath)) {
    return true;
  }

  for (const prefix of DEMO_MUTATION_ALLOWED_PREFIXES) {
    if (normalizedPath.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

export function isDemoMutationAllowed(method: string, path: string): boolean {
  const upperMethod = method.toUpperCase();
  if (
    upperMethod === 'GET' ||
    upperMethod === 'HEAD' ||
    upperMethod === 'OPTIONS'
  ) {
    return true;
  }

  if (upperMethod === 'DELETE') {
    return false;
  }

  const normalizedPath = normalizeDemoRequestPath(path);
  return isDemoMutationPathAllowed(normalizedPath);
}

export function demoAccessExpiresAt(from: Date = new Date()): Date {
  return new Date(
    from.getTime() + DEMO_ACCESS_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function demoMagicLinkExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + DEMO_MAGIC_LINK_TTL_MS);
}
