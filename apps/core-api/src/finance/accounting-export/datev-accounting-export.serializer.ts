import { DEFAULT_DE_PROFILE_CODE } from '../accounting-profile/accounting-profile.codes.js';
import {
  DATEV_MAX_CSV_BYTES,
  DATEV_MAX_DOCUMENTS_PER_RUN,
} from './datev-format.constants.js';
import {
  buildAccountingExportFilename,
  serializeDatevBuchungsstapel,
} from './datev-serializer.js';
import type {
  AccountingExportSerializerInput,
  AccountingExportSerializerPort,
  AccountingExportSerializerResult,
} from './accounting-export-serializer.types.js';

function serializeDatev(
  input: AccountingExportSerializerInput,
): AccountingExportSerializerResult {
  const result = serializeDatevBuchungsstapel(input);
  return {
    bytes: result.bytes,
    sha256: result.sha256,
    rowCount: result.rowCount,
    byteLength: result.byteLength,
  };
}

export const datevAccountingExportSerializer: AccountingExportSerializerPort = {
  profileCode: DEFAULT_DE_PROFILE_CODE,
  isImplemented: true,
  limits: {
    maxCsvBytes: DATEV_MAX_CSV_BYTES,
    maxDocumentsPerRun: DATEV_MAX_DOCUMENTS_PER_RUN,
  },
  serialize: serializeDatev,
  buildFilename: buildAccountingExportFilename,
};
