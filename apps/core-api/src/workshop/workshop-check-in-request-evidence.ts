import { createHmac, createHash } from 'node:crypto';

function evidenceHmacSecret(): string {
  const key = process.env.SECRET_ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY is required for check-in evidence hashing',
    );
  }
  return key;
}

function tenantScopedHmac(tenantId: string, material: string): string {
  return createHmac('sha256', evidenceHmacSecret())
    .update(`${tenantId}\0${material}`)
    .digest('hex');
}

/** SHA-256 HMAC of the request User-Agent (no raw UA retained on the check-in row). */
export function hashCheckInDeviceEvidence(
  tenantId: string,
  userAgent: string | undefined,
): string {
  const normalized = userAgent?.trim() || 'unknown';
  return tenantScopedHmac(tenantId, `device:${normalized}`);
}

/** SHA-256 HMAC of the observed client IP (no raw IP retained on the check-in row). */
export function hashCheckInIpEvidence(
  tenantId: string,
  ip: string | undefined,
): string | null {
  const normalized = ip?.trim();
  if (!normalized) {
    return null;
  }
  return tenantScopedHmac(tenantId, `ip:${normalized}`);
}

export function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
