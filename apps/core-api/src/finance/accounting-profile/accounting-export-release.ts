import { isExportSerializerReleased } from './accounting-profile.codes.js';
import {
  isBmdProfileCode,
  isBmdSerializerReleased,
} from './bmd-profile.codes.js';

/**
 * Whether a profile may be enabled and generate CSV. BMD has its own default-off
 * flag; DATEV and RZL keep their existing rules.
 */
export function isAccountingExportReleased(
  profileCode: string | null | undefined,
): boolean {
  if (isBmdProfileCode(profileCode)) {
    return isBmdSerializerReleased();
  }
  return isExportSerializerReleased(profileCode);
}
