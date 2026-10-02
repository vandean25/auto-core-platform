import { UnprocessableEntityException } from '@nestjs/common';
import {
  DEFAULT_AT_PROFILE_CODE,
  DEFAULT_DE_PROFILE_CODE,
  isExportSerializerImplemented,
} from '../accounting-profile/accounting-profile.codes.js';
import type { AccountingExportSerializerPort } from './accounting-export-serializer.types.js';
import { datevAccountingExportSerializer } from './datev-accounting-export.serializer.js';
import { buildAccountingExportFilename } from './datev-serializer.js';
import {
  DATEV_MAX_CSV_BYTES,
  DATEV_MAX_DOCUMENTS_PER_RUN,
} from './datev-format.constants.js';

const rzlAccountingExportSerializerStub: AccountingExportSerializerPort = {
  profileCode: DEFAULT_AT_PROFILE_CODE,
  isImplemented: false,
  limits: {
    maxCsvBytes: DATEV_MAX_CSV_BYTES,
    maxDocumentsPerRun: DATEV_MAX_DOCUMENTS_PER_RUN,
  },
  serialize() {
    throw new UnprocessableEntityException({
      code: 'EXPORT_SERIALIZER_NOT_IMPLEMENTED',
      message:
        'RZL accounting export serialization is not enabled until AUT-361/AUT-368 gates pass.',
    });
  },
  buildFilename: buildAccountingExportFilename,
};

const serializersByProfileCode = new Map<
  string,
  AccountingExportSerializerPort
>([
  [DEFAULT_DE_PROFILE_CODE, datevAccountingExportSerializer],
  [DEFAULT_AT_PROFILE_CODE, rzlAccountingExportSerializerStub],
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
  return isEnabled && isExportSerializerImplemented(profileCode);
}
