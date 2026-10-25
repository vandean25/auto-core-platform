import type { ImportEntityType, ImportRowAction, Prisma } from '@prisma/client';
import type { ParsedCsv } from './csv-parse.util.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportJobTotals,
} from './import.types.js';
import type { SerializedImportJob } from './import-job.serializer.js';

/** A job row as loaded for apply. */
export type ImportApplyRow = {
  row_no: number;
  action: ImportRowAction;
  entity_id: string | null;
  external_id: string | null;
  normalized_json: Prisma.JsonValue;
};

/** The job fields the apply stage reads. */
export type ImportApplyJob = {
  id: string;
  source_system: string;
  options_json: Prisma.JsonValue;
};

export type VendorRef = { id: string; name: string };

/** What a handler resolves before the job is locked. Only supplier imports set a vendor. */
export type ImportApplyPreparation = { vendor: VendorRef | null };

export type ImportDryRunInput = {
  tenantId: string;
  sourceSystem: string;
  mapping: Record<string, string>;
  options: ImportJobOptions;
};

export type ImportApplyBatchOptions = {
  resumeAfterRowNo?: number;
  stopAfterBatch?: boolean;
};

export type ImportApplyInput = {
  tenantId: string;
  job: ImportApplyJob;
  rows: ImportApplyRow[];
  actorUserId: string;
  effectiveOptions: ImportJobOptions;
  preparation: ImportApplyPreparation;
  batchOptions?: ImportApplyBatchOptions;
};

/**
 * One import type (customer, vehicle, supplier price list). ImportService picks a handler by
 * entity type and runs the same stages for each: prepare, plan, persist, then apply.
 */
export interface ImportTypeHandler {
  readonly entityType: ImportEntityType;

  /** Runs before the dry run. Supplier imports resolve the vendor and store its id on options. */
  prepareCreate(
    tenantId: string,
    sourceSystem: string,
    options: ImportJobOptions,
  ): Promise<void>;

  /** Plans every parsed row against the tenant's current data. */
  planDryRun(
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ): Promise<DryRunRowResult[]>;

  /** Runs after the job is stored. Returns the totals to report for the new job. */
  finishCreate?(input: {
    tenantId: string;
    jobId: string;
    rows: DryRunRowResult[];
    totals: ImportJobTotals;
  }): Promise<ImportJobTotals>;

  /** Checks that run before the job is locked for apply. */
  prepareApply(input: {
    tenantId: string;
    job: ImportApplyJob;
    rows: ImportApplyRow[];
    applyOptions?: ImportJobOptions;
    effectiveOptions: ImportJobOptions;
  }): Promise<ImportApplyPreparation>;

  /** Applies the rows of a locked job and returns the applied job. */
  apply(input: ImportApplyInput): Promise<SerializedImportJob>;
}
