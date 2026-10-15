import { createHash } from 'node:crypto';

export const DEMO_ACCESS_DURATION_DAYS = 14;
export const DEMO_MAGIC_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const BLOCKED_DEMO_MUTATION_PREFIXES = [
  '/api/tenant-members',
  '/api/platform-admin',
  '/api/tenant-api-keys',
  '/api/settings',
  '/api/auth/switch-tenant',
  '/api/notifications',
  '/api/import',
  '/api/accounting-exports',
  '/api/mcp',
] as const;

const BLOCKED_DEMO_MUTATION_EXACT = new Set(['/api/workshop/estimates']);

export function hashClientIp(ip: string | null | undefined): string | null {
  const normalized = ip?.trim();
  if (!normalized) {
    return null;
  }
  return createHash('sha256').update(normalized).digest('hex');
}

export function normalizeDemoEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isLandingDemoHoneypotTriggered(
  website?: string | null,
): boolean {
  return Boolean(website && website.trim() !== '');
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

  const normalizedPath = path.split('?')[0]?.toLowerCase() ?? '';
  if (BLOCKED_DEMO_MUTATION_EXACT.has(normalizedPath)) {
    return false;
  }

  for (const prefix of BLOCKED_DEMO_MUTATION_PREFIXES) {
    if (normalizedPath.startsWith(prefix)) {
      return false;
    }
  }

  if (upperMethod === 'DELETE') {
    return false;
  }

  if (
    normalizedPath.includes('/send') ||
    normalizedPath.includes('/finalize') ||
    normalizedPath.includes('/submit')
  ) {
    return false;
  }

  return true;
}

export function demoAccessExpiresAt(from: Date = new Date()): Date {
  return new Date(
    from.getTime() + DEMO_ACCESS_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function demoMagicLinkExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + DEMO_MAGIC_LINK_TTL_MS);
}
