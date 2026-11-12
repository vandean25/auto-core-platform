import { isUuidV7 } from './guarded-price.uuid.js';
import { guardedRequestInvalid } from './guarded-price.errors.js';

export type PriceOperationDiscoveryCursor = {
  acceptedAt: string;
  key: string;
};

export function encodePriceOperationDiscoveryCursor(
  cursor: PriceOperationDiscoveryCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function parsePriceOperationDiscoveryCursor(
  raw: string | undefined,
): PriceOperationDiscoveryCursor | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<PriceOperationDiscoveryCursor>;
    if (
      typeof decoded.acceptedAt !== 'string' ||
      typeof decoded.key !== 'string' ||
      decoded.key.length === 0
    ) {
      throw new Error('invalid cursor');
    }
    const acceptedAt = new Date(decoded.acceptedAt);
    if (Number.isNaN(acceptedAt.getTime())) {
      throw new Error('invalid acceptedAt');
    }
    if (!isUuidV7(decoded.key)) {
      throw new Error('invalid key');
    }
    return { acceptedAt: acceptedAt.toISOString(), key: decoded.key };
  } catch {
    guardedRequestInvalid('Invalid discovery cursor.');
  }
}
