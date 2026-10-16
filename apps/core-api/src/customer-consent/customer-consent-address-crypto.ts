import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import type { CustomerConsentChannel } from '@prisma/client';

const ADDRESS_HMAC_VERSION = 1;

function encryptionKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY is required for contact address storage.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
    );
  }
  return key;
}

export function normalizeContactAddress(
  channel: CustomerConsentChannel,
  raw: string,
): string {
  const trimmed = raw.trim();
  if (channel === 'EMAIL') {
    const at = trimmed.lastIndexOf('@');
    if (at <= 0) {
      return trimmed.toLowerCase();
    }
    const local = trimmed.slice(0, at);
    const domain = trimmed.slice(at + 1).toLowerCase();
    return `${local}@${domain}`;
  }
  return trimmed;
}

export function encryptContactAddress(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptContactAddress(ciphertext: string): string {
  const key = encryptionKey();
  const [version, ivB64, tagB64, encryptedB64] = ciphertext.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !encryptedB64) {
    throw new Error('Invalid encrypted contact address format.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function fingerprintContactAddress(
  tenantId: string,
  channel: CustomerConsentChannel,
  normalized: string,
): string {
  return createHmac('sha256', encryptionKey())
    .update(
      `${ADDRESS_HMAC_VERSION}:${tenantId}:${channel}:${normalized}`,
      'utf8',
    )
    .digest('hex');
}
