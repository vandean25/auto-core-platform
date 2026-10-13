import { UnprocessableEntityException } from '@nestjs/common';
import {
  DEFAULT_BMD_AT_PROFILE_CODE,
  isBmdSerializerReleased,
} from '../accounting-profile/bmd-profile.codes.js';
import type { AccountingExportSerializerPort } from './accounting-export-serializer.types.js';
import {
  BMD_MAX_CSV_BYTES,
  BMD_MAX_DOCUMENTS_PER_RUN,
} from './bmd-format.constants.js';
import {
  buildBmdAccountingExportFilename,
  serializeBmdNtcsImport,
} from './bmd-ntcs-import.serializer.js';

export const bmdAccountingExportSerializer: AccountingExportSerializerPort = {
  profileCode: DEFAULT_BMD_AT_PROFILE_CODE,
  isImplemented: true,
  limits: {
    maxCsvBytes: BMD_MAX_CSV_BYTES,
    maxDocumentsPerRun: BMD_MAX_DOCUMENTS_PER_RUN,
  },
  serialize(input) {
    // Fail closed even if the flag was switched off after the preview.
    if (!isBmdSerializerReleased()) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_PROFILE_DISABLED',
        message: 'Accounting export profile is not enabled.',
      });
    }
    const result = serializeBmdNtcsImport(input);
    return {
      bytes: result.bytes,
      sha256: result.sha256,
      rowCount: result.rowCount,
      byteLength: result.byteLength,
    };
  },
  buildFilename: buildBmdAccountingExportFilename,
};
