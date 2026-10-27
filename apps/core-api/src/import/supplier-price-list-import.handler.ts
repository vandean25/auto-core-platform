import { BadRequestException } from '@nestjs/common';
import { ImportEntityType, ImportRowAction } from '@prisma/client';
import type { ParsedCsv } from './csv-parse.util.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { ImportVendorResolver } from './import-vendor.resolver.js';
import type { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';
import {
  type ImportApplyInput,
  type ImportApplyPreparation,
  type ImportApplyRow,
  type ImportDryRunInput,
  type ImportTypeHandler,
  type VendorRef,
} from './import-type-handler.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { DryRunRowResult, ImportJobOptions } from './import.types.js';
import { planSupplierPriceListRows } from './supplier-price-list-import.dry-run.js';

/**
 * A price list may only be applied when every flagged price jump is accepted, either for
 * all rows or for the listed row numbers. Only the apply request is checked here.
 */
function assertPriceJumpsAccepted(
  rows: ImportApplyRow[],
  applyOptions?: ImportJobOptions,
): void {
  const isAllAccepted = applyOptions?.accept_all_price_jumps === true;
  const acceptedRowSet = new Set(
    Array.isArray(applyOptions?.accepted_row_numbers)
      ? applyOptions.accepted_row_numbers
      : [],
  );

  for (const row of rows) {
    if (row.action === ImportRowAction.ERROR) {
      continue;
    }
    const normalized = row.normalized_json as Record<string, unknown> | null;
    if (
      normalized?.price_jump_flagged === true &&
      !isAllAccepted &&
      !acceptedRowSet.has(row.row_no)
    ) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.PRICE_JUMP_REQUIRES_ACCEPTANCE,
        message: 'Price changes exceeding threshold must be accepted',
      });
    }
  }
}

/** Supplier price list imports. Matching is against the vendor's catalog and margin rules. */
export class SupplierPriceListImportHandler implements ImportTypeHandler {
  readonly entityType = ImportEntityType.SUPPLIER_PRICE_LIST;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: ImportVendorResolver,
    private readonly runner: SupplierChunkedApplyRunner,
  ) {}

  applySequenceOrderKey() {
    return 'row_no' as const;
  }

  /** Stores the resolved vendor id on the job options, so later steps use the same vendor. */
  async prepareCreate(
    tenantId: string,
    sourceSystem: string,
    options: ImportJobOptions,
  ): Promise<void> {
    const vendor = await this.vendors.resolve(
      tenantId,
      sourceSystem,
      options.vendor_id,
    );
    options.vendor_id = vendor.id;
  }

  async planDryRun(
    input: ImportDryRunInput,
    parsed: ParsedCsv,
  ): Promise<DryRunRowResult[]> {
    const vendor = await this.vendors.resolve(
      input.tenantId,
      input.sourceSystem,
      input.options.vendor_id,
    );
    return planSupplierPriceListRows(
      this.prisma,
      {
        tenantId: input.tenantId,
        vendorId: vendor.id,
        mapping: input.mapping,
        options: input.options,
      },
      parsed,
      input.planBudget,
    );
  }

  async prepareApply(input: {
    tenantId: string;
    job: { source_system: string };
    rows: ImportApplyRow[];
    applyOptions?: ImportJobOptions;
    effectiveOptions: ImportJobOptions;
  }): Promise<ImportApplyPreparation> {
    assertPriceJumpsAccepted(input.rows, input.applyOptions);
    const vendor = await this.vendors.resolve(
      input.tenantId,
      input.job.source_system,
      input.effectiveOptions.vendor_id,
    );
    return { vendor };
  }

  apply(input: ImportApplyInput): Promise<SerializedImportJob> {
    // prepareApply always sets the vendor before the job is locked.
    return this.runner.run(input, input.preparation.vendor as VendorRef);
  }
}
