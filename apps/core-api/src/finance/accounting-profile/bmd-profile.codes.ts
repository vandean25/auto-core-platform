/** BMD (AT) accounting profile: profile code, pinned layout identifier and release gate. */
export const DEFAULT_BMD_AT_PROFILE_CODE = 'ACP-BMD-AT-EUR-1';
/**
 * ACP identifier of the BMD NTCS booking layout implemented in
 * `bmd-ntcs-import.serializer.ts`. It is not a version published by BMD. Field
 * order and separators are checked against public sources in the spec's source
 * matrix (AUT-520); vendor acceptance is still open. See
 * docs/internal/02-Feature-Specs/Finance/bmd-accounting-export.md.
 */
export const DEFAULT_BMD_FORMAT_VERSION = 'BMD-NTCS-ASCII-IMPORT-ACP-DRAFT-1';
/** Platform release gate for BMD CSV generation and enablement. Default OFF until BMD validation. */
export const BMD_SERIALIZER_RELEASE_ENV =
  'ACCOUNTING_EXPORT_BMD_SERIALIZER_ENABLED';

export function isBmdProfileCode(
  profileCode: string | null | undefined,
): boolean {
  return profileCode === DEFAULT_BMD_AT_PROFILE_CODE;
}

export function isBmdSerializerReleased(): boolean {
  return process.env[BMD_SERIALIZER_RELEASE_ENV] === 'true';
}
