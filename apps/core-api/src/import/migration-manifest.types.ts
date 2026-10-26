import type { MigrationCsvFileName } from './migration-csv-dictionary.js';

export type MigrationValidationIssue = {
  code: string;
  message: string;
  file?: string;
  row?: number;
  external_id?: string;
  field?: string;
};

export type MigrationManifestFileEntry = {
  name: MigrationCsvFileName;
  sha256: string;
  row_count: number;
};

export type MigrationManifest = {
  format_version: string;
  source_name: string;
  source_system: string;
  source_company_code: string;
  extracted_at: string;
  cutover_date: string;
  currency: string;
  files: MigrationManifestFileEntry[];
  control_totals: Record<string, unknown>;
  assets?: unknown[];
};

export type MigrationPresentFileStats = {
  sha256: string;
  rowCount: number;
};

export type MigrationBundleInput = {
  manifest: MigrationManifest;
  files: Record<string, Buffer>;
  assets?: Record<string, Buffer>;
  allowPartialFiles?: boolean;
  /** Files uploaded in this request without loading full buffers (reconciliation only). */
  presentFileNames?: string[];
  /** Manifest hash/row_count checks for streamed uploads. */
  presentFileStats?: Record<string, MigrationPresentFileStats>;
};
