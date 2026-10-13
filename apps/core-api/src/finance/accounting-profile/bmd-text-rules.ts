import { isRzlSafeText } from './rzl-text-rules.js';

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

/**
 * Text a BMD booking file can carry in a quoted field: non-empty printable ASCII,
 * so the bytes are the same under ASCII and Windows-1252. Also without the field
 * separator or quotes, and not formula-leading. Reuses the shared Windows-1252
 * field rule and adds the ASCII restriction the BMD layout assumes (spec A4).
 * Shared by export readiness (blockers) and the serializer's field guard.
 */
export function isBmdSafeText(value: string): boolean {
  return PRINTABLE_ASCII.test(value) && isRzlSafeText(value);
}
