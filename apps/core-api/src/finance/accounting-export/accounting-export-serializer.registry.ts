import { UnprocessableEntityException } from '@nestjs/common';
import {
  DEFAULT_AT_PROFILE_CODE,
  DEFAULT_DE_PROFILE_CODE,
  isExportSerializerReleased,
} from '../accounting-profile/accounting-profile.codes.js';
import type {
  AccountingExportFilenameInput,
  AccountingExportSerializerPort,
} from './accounting-export-serializer.types.js';
import { datevAccountingExportSerializer } from './datev-accounting-export.serializer.js';
import { buildAccountingExportFilename } from './datev-serializer.js';
import { rzlAccountingExportSerializer } from './rzl-accounting-export.serializer.js';

const serializersByProfileCode = new Map<
  string,
  AccountingExportSerializerPort
>([
  [DEFAULT_DE_PROFILE_CODE, datevAccountingExportSerializer],
  [DEFAULT_AT_PROFILE_CODE, rzlAccountingExportSerializer],
]);

export function resolveAccountingExportSerializer(
  profileCode: string | null | undefined,
): AccountingExportSerializerPort {
  if (!profileCode) {
    throw new UnprocessableEntityException({
      code: 'EXPORT_PROFILE_NOT_READY',
      message: 'Accounting export profile code is not configured.',
    });
  }

  const serializer = serializersByProfileCode.get(profileCode);
  if (!serializer) {
    throw new UnprocessableEntityException({
      code: 'EXPORT_SERIALIZER_UNSUPPORTED',
      message: `No accounting export serializer is registered for ${profileCode}.`,
    });
  }

  return serializer;
}

export function exportProfileCanGenerate(
  profileCode: string | null | undefined,
  isEnabled: boolean,
): boolean {
  return isEnabled && isExportSerializerReleased(profileCode);
}

/** Read paths: legacy runs may have null or unknown profile codes in frozen snapshots. */
export function buildAccountingExportFilenameForRun(
  profileCode: unknown,
  input: AccountingExportFilenameInput,
): string {
  const serializer =
    typeof profileCode === 'string'
      ? serializersByProfileCode.get(profileCode)
      : undefined;
  return (serializer?.buildFilename ?? buildAccountingExportFilename)(input);
}
