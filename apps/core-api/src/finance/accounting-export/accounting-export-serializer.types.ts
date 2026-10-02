import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from './accounting-export.types.js';

export type AccountingExportSerializerInput = {
  profile: AccountingExportProfileSnapshot;
  dateFrom: string;
  dateTo: string;
  createdAt: Date;
  rows: AccountingExportBookingRow[];
};

export type AccountingExportSerializerResult = {
  bytes: Buffer;
  sha256: string;
  rowCount: number;
  byteLength: number;
};

export type AccountingExportFilenameInput = {
  legalEntityId: string;
  dateFrom: string;
  dateTo: string;
  runId: string;
};

export type AccountingExportSerializerLimits = {
  maxCsvBytes: number;
  maxDocumentsPerRun: number;
};

export type AccountingExportSerializerPort = {
  profileCode: string;
  isImplemented: boolean;
  limits: AccountingExportSerializerLimits;
  serialize(
    input: AccountingExportSerializerInput,
  ): AccountingExportSerializerResult;
  buildFilename(input: AccountingExportFilenameInput): string;
};
