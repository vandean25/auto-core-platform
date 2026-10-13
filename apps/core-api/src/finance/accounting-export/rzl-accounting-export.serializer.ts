import { UnprocessableEntityException } from '@nestjs/common';
import {
  DEFAULT_AT_PROFILE_CODE,
  isRzlSerializerReleased,
} from '../accounting-profile/accounting-profile.codes.js';
import type {
  AccountingExportSerializerInput,
  AccountingExportSerializerPort,
  AccountingExportSerializerResult,
} from './accounting-export-serializer.types.js';
import {
  buildRzlAccountingExportFilename,
  serializeRzlFibuImport,
} from './rzl-fibu-import.serializer.js';
import {
  RZL_MAX_CSV_BYTES,
  RZL_MAX_DOCUMENTS_PER_RUN,
} from './rzl-format.constants.js';

export const rzlAccountingExportSerializer: AccountingExportSerializerPort = {
  profileCode: DEFAULT_AT_PROFILE_CODE,
  isImplemented: true,
  limits: {
    maxCsvBytes: RZL_MAX_CSV_BYTES,
    maxDocumentsPerRun: RZL_MAX_DOCUMENTS_PER_RUN,
  },
  serialize(
    input: AccountingExportSerializerInput,
  ): AccountingExportSerializerResult {
    // Fail closed even if the flag was switched off after the preview.
    if (!isRzlSerializerReleased()) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_PROFILE_DISABLED',
        message: 'Accounting export profile is not enabled.',
      });
    }
    const result = serializeRzlFibuImport(input);
    return {
      bytes: result.bytes,
      sha256: result.sha256,
      rowCount: result.rowCount,
      byteLength: result.byteLength,
    };
  },
  buildFilename: buildRzlAccountingExportFilename,
};
