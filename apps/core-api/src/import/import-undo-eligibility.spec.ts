import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import {
  findUndoableJobIds,
  hasUndoableRows,
  isCandidateUndoableJob,
  type UndoableBatchCheckClient,
  type UndoableRowCheckClient,
} from './import-undo.helpers.js';
import { SUPPLIER_PRICE_LIST_ENTITY_TYPE } from './import-undo-plan.js';

describe('Import Undo Eligibility (AUT-846)', () => {
  const tenantId = 'tenant-test-123';

  describe('isCandidateUndoableJob', () => {
    it('returns true for APPLIED, PARTIALLY_UNDONE, and FAILED non-financial imports', () => {
      expect(
        isCandidateUndoableJob({
          status: ImportJobStatus.APPLIED,
          entity_type: ImportEntityType.CUSTOMER,
        }),
      ).toBe(true);

      expect(
        isCandidateUndoableJob({
          status: ImportJobStatus.PARTIALLY_UNDONE,
          entity_type: ImportEntityType.VEHICLE,
        }),
      ).toBe(true);

      expect(
        isCandidateUndoableJob({
          status: ImportJobStatus.FAILED,
          entity_type: ImportEntityType.CUSTOMER,
        }),
      ).toBe(true);
    });

    it('returns false for financial / document imports', () => {
      expect(
        isCandidateUndoableJob({
          status: ImportJobStatus.APPLIED,
          entity_type: ImportEntityType.LEGACY_INVOICE,
        }),
      ).toBe(false);
    });

    it('returns false for other statuses like DRY_RUN_DONE, UNDONE, APPLYING', () => {
      expect(
        isCandidateUndoableJob({
          status: ImportJobStatus.DRY_RUN_DONE,
          entity_type: ImportEntityType.CUSTOMER,
        }),
      ).toBe(false);

      expect(
        isCandidateUndoableJob({
          status: ImportJobStatus.UNDONE,
          entity_type: ImportEntityType.CUSTOMER,
        }),
      ).toBe(false);

      expect(
        isCandidateUndoableJob({
          status: ImportJobStatus.APPLYING,
          entity_type: ImportEntityType.CUSTOMER,
        }),
      ).toBe(false);
    });

    it('returns false when rows_purged is true or cancel_reason is expired', () => {
      expect(
        isCandidateUndoableJob({
          status: ImportJobStatus.APPLIED,
          entity_type: ImportEntityType.CUSTOMER,
          options_json: { rows_purged: true },
        }),
      ).toBe(false);

      expect(
        isCandidateUndoableJob({
          status: ImportJobStatus.FAILED,
          entity_type: ImportEntityType.CUSTOMER,
          options_json: { cancel_reason: 'expired' },
        }),
      ).toBe(false);
    });
  });

  describe('hasUndoableRows', () => {
    it('queries importJobRow with tenant_id, CREATE/UPDATE, entity_id not null, undone_at null', async () => {
      const mockFindFirst = jest.fn().mockResolvedValue({ row_no: 1 });
      const client: UndoableRowCheckClient = {
        importJobRow: { findFirst: mockFindFirst },
        catalogPriceHistory: { findFirst: jest.fn() },
      };

      const result = await hasUndoableRows(client, tenantId, {
        id: 'job-1',
        entity_type: ImportEntityType.CUSTOMER,
      });

      expect(result).toBe(true);
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          import_job_id: 'job-1',
          action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
          entity_id: { not: null },
          undone_at: null,
        },
        select: { row_no: true },
      });
    });

    it('returns false when no un-undone row exists with entity_id', async () => {
      const mockFindFirst = jest.fn().mockResolvedValue(null);
      const client: UndoableRowCheckClient = {
        importJobRow: { findFirst: mockFindFirst },
        catalogPriceHistory: { findFirst: jest.fn() },
      };

      const result = await hasUndoableRows(client, tenantId, {
        id: 'legacy-job',
        entity_type: ImportEntityType.CUSTOMER,
      });

      expect(result).toBe(false);
    });

    it('queries catalogPriceHistory for SUPPLIER_PRICE_LIST', async () => {
      const mockHistoryFindFirst = jest.fn().mockResolvedValue({ id: 'cph-1' });
      const client: UndoableRowCheckClient = {
        importJobRow: { findFirst: jest.fn() },
        catalogPriceHistory: { findFirst: mockHistoryFindFirst },
      };

      const result = await hasUndoableRows(client, tenantId, {
        id: 'spl-job',
        entity_type: SUPPLIER_PRICE_LIST_ENTITY_TYPE,
      });

      expect(result).toBe(true);
      expect(mockHistoryFindFirst).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, import_job_id: 'spl-job' },
        select: { id: true },
      });
    });
  });

  describe('findUndoableJobIds (Batched query per page - No N+1)', () => {
    it('performs exactly one batched query per table for candidate jobs on the page', async () => {
      const importJobRowFindMany = jest.fn().mockResolvedValue([
        { import_job_id: 'job-applied' },
        { import_job_id: 'job-failed-partial' },
      ]);
      const catalogPriceHistoryFindMany = jest.fn().mockResolvedValue([
        { import_job_id: 'job-spl' },
      ]);

      const client: UndoableBatchCheckClient = {
        importJobRow: { findMany: importJobRowFindMany },
        catalogPriceHistory: { findMany: catalogPriceHistoryFindMany },
      };

      const pageJobs = [
        {
          id: 'job-applied',
          status: ImportJobStatus.APPLIED,
          entity_type: ImportEntityType.CUSTOMER,
        },
        {
          id: 'job-legacy-applied',
          status: ImportJobStatus.APPLIED,
          entity_type: ImportEntityType.CUSTOMER,
        },
        {
          id: 'job-failed-dry-run',
          status: ImportJobStatus.FAILED,
          entity_type: ImportEntityType.CUSTOMER,
        },
        {
          id: 'job-failed-partial',
          status: ImportJobStatus.FAILED,
          entity_type: ImportEntityType.CUSTOMER,
        },
        {
          id: 'job-undone',
          status: ImportJobStatus.UNDONE,
          entity_type: ImportEntityType.CUSTOMER,
        },
        {
          id: 'job-dry-run-done',
          status: ImportJobStatus.DRY_RUN_DONE,
          entity_type: ImportEntityType.CUSTOMER,
        },
        {
          id: 'job-financial',
          status: ImportJobStatus.APPLIED,
          entity_type: ImportEntityType.LEGACY_INVOICE,
        },
        {
          id: 'job-purged',
          status: ImportJobStatus.APPLIED,
          entity_type: ImportEntityType.CUSTOMER,
          options_json: { rows_purged: true },
        },
        {
          id: 'job-spl',
          status: ImportJobStatus.APPLIED,
          entity_type: SUPPLIER_PRICE_LIST_ENTITY_TYPE,
        },
      ];

      const undoableIds = await findUndoableJobIds(client, tenantId, pageJobs);

      // Verify batched query was called exactly once for standard jobs and once for price list jobs
      expect(importJobRowFindMany).toHaveBeenCalledTimes(1);
      expect(catalogPriceHistoryFindMany).toHaveBeenCalledTimes(1);

      // Verify the standard jobs filter only candidate standard job IDs
      expect(importJobRowFindMany).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          import_job_id: {
            in: [
              'job-applied',
              'job-legacy-applied',
              'job-failed-dry-run',
              'job-failed-partial',
            ],
          },
          action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
          entity_id: { not: null },
          undone_at: null,
        },
        select: { import_job_id: true },
        distinct: ['import_job_id'],
      });

      // Verify the price list filter only candidate price list job IDs
      expect(catalogPriceHistoryFindMany).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          import_job_id: { in: ['job-spl'] },
        },
        select: { import_job_id: true },
        distinct: ['import_job_id'],
      });

      // Verify results:
      // - APPLIED with entity_ids: true ('job-applied')
      // - Legacy APPLIED without entity_ids: false ('job-legacy-applied')
      // - FAILED dry-run: false ('job-failed-dry-run')
      // - FAILED partial apply: true ('job-failed-partial')
      // - UNDONE: false
      // - DRY_RUN_DONE: false
      // - Financial: false
      // - Purged: false
      // - SPL: true ('job-spl')
      expect(undoableIds.has('job-applied')).toBe(true);
      expect(undoableIds.has('job-failed-partial')).toBe(true);
      expect(undoableIds.has('job-spl')).toBe(true);
      expect(undoableIds.has('job-legacy-applied')).toBe(false);
      expect(undoableIds.has('job-failed-dry-run')).toBe(false);
      expect(undoableIds.has('job-undone')).toBe(false);
      expect(undoableIds.has('job-dry-run-done')).toBe(false);
      expect(undoableIds.has('job-financial')).toBe(false);
      expect(undoableIds.has('job-purged')).toBe(false);
    });

    it('skips database queries entirely when page has no candidate jobs', async () => {
      const importJobRowFindMany = jest.fn();
      const catalogPriceHistoryFindMany = jest.fn();

      const client: UndoableBatchCheckClient = {
        importJobRow: { findMany: importJobRowFindMany },
        catalogPriceHistory: { findMany: catalogPriceHistoryFindMany },
      };

      const nonCandidateJobs = [
        {
          id: 'job-undone',
          status: ImportJobStatus.UNDONE,
          entity_type: ImportEntityType.CUSTOMER,
        },
        {
          id: 'job-dry-run',
          status: ImportJobStatus.DRY_RUN_DONE,
          entity_type: ImportEntityType.CUSTOMER,
        },
        {
          id: 'job-financial',
          status: ImportJobStatus.APPLIED,
          entity_type: ImportEntityType.LEGACY_INVOICE,
        },
      ];

      const undoableIds = await findUndoableJobIds(
        client,
        tenantId,
        nonCandidateJobs,
      );

      expect(undoableIds.size).toBe(0);
      expect(importJobRowFindMany).not.toHaveBeenCalled();
      expect(catalogPriceHistoryFindMany).not.toHaveBeenCalled();
    });
  });
});
