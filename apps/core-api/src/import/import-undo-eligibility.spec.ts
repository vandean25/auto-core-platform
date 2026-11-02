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
    it.each([
      {
        label: 'APPLIED non-financial import',
        status: ImportJobStatus.APPLIED,
        entity_type: ImportEntityType.CUSTOMER,
        options_json: undefined,
        expected: true,
      },
      {
        label: 'PARTIALLY_UNDONE non-financial import',
        status: ImportJobStatus.PARTIALLY_UNDONE,
        entity_type: ImportEntityType.VEHICLE,
        options_json: undefined,
        expected: true,
      },
      {
        label: 'FAILED non-financial import',
        status: ImportJobStatus.FAILED,
        entity_type: ImportEntityType.CUSTOMER,
        options_json: undefined,
        expected: true,
      },
      {
        label: 'APPLIED financial import',
        status: ImportJobStatus.APPLIED,
        entity_type: ImportEntityType.LEGACY_INVOICE,
        options_json: undefined,
        expected: false,
      },
      {
        label: 'DRY_RUN_DONE import',
        status: ImportJobStatus.DRY_RUN_DONE,
        entity_type: ImportEntityType.CUSTOMER,
        options_json: undefined,
        expected: false,
      },
      {
        label: 'UNDONE import',
        status: ImportJobStatus.UNDONE,
        entity_type: ImportEntityType.CUSTOMER,
        options_json: undefined,
        expected: false,
      },
      {
        label: 'APPLYING import',
        status: ImportJobStatus.APPLYING,
        entity_type: ImportEntityType.CUSTOMER,
        options_json: undefined,
        expected: false,
      },
      {
        label: 'purged rows',
        status: ImportJobStatus.APPLIED,
        entity_type: ImportEntityType.CUSTOMER,
        options_json: { rows_purged: true },
        expected: false,
      },
      {
        label: 'expired cancel',
        status: ImportJobStatus.FAILED,
        entity_type: ImportEntityType.CUSTOMER,
        options_json: { cancel_reason: 'expired' },
        expected: false,
      },
    ])(
      '$label is candidate: $expected',
      ({ status, entity_type, options_json, expected }) => {
        expect(
          isCandidateUndoableJob({ status, entity_type, options_json }),
        ).toBe(expected);
      },
    );
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

    it('queries catalogPriceHistory for SUPPLIER_PRICE_LIST with old_cost not null', async () => {
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
        where: {
          tenant_id: tenantId,
          import_job_id: 'spl-job',
          old_cost: { not: null },
        },
        select: { id: true },
      });
    });

    it('returns false for SUPPLIER_PRICE_LIST when all history rows have null old_cost', async () => {
      const mockHistoryFindFirst = jest.fn().mockResolvedValue(null);
      const client: UndoableRowCheckClient = {
        importJobRow: { findFirst: jest.fn() },
        catalogPriceHistory: { findFirst: mockHistoryFindFirst },
      };

      const result = await hasUndoableRows(client, tenantId, {
        id: 'spl-job',
        entity_type: SUPPLIER_PRICE_LIST_ENTITY_TYPE,
      });

      expect(result).toBe(false);
      expect(mockHistoryFindFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          import_job_id: 'spl-job',
          old_cost: { not: null },
        },
        select: { id: true },
      });
    });
  });

  describe('findUndoableJobIds (Batched query per page - No N+1)', () => {
    it('performs exactly one batched query per table for candidate jobs on the page (raw SQL query shape)', async () => {
      const mockQueryRaw = jest
        .fn()
        // First call: standard jobs
        .mockResolvedValueOnce([
          { import_job_id: 'job-applied' },
          { import_job_id: 'job-failed-partial' },
        ])
        // Second call: price list jobs
        .mockResolvedValueOnce([{ import_job_id: 'job-spl' }]);

      const client: UndoableBatchCheckClient = {
        $queryRaw: mockQueryRaw,
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
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);

      // Verify first query shape (standard jobs with EXISTS subquery and early exit)
      const standardCallArg = mockQueryRaw.mock.calls[0][0];
      const standardSql = standardCallArg.sql;
      expect(standardSql).toContain('import_job_rows');
      expect(standardSql).toContain('EXISTS');
      expect(standardSql).toContain('CREATE');
      expect(standardSql).toContain('UPDATE');
      expect(standardSql).toContain('entity_id IS NOT NULL');
      expect(standardSql).toContain('undone_at IS NULL');
      expect(standardCallArg.values).toContain(tenantId);
      expect(standardCallArg.values).toContain('job-applied');
      expect(standardCallArg.values).toContain('job-failed-partial');

      // Verify second query shape (price list jobs with EXISTS subquery and old_cost IS NOT NULL)
      const priceListCallArg = mockQueryRaw.mock.calls[1][0];
      const priceListSql = priceListCallArg.sql;
      expect(priceListSql).toContain('catalog_price_histories');
      expect(priceListSql).toContain('EXISTS');
      expect(priceListSql).toContain('old_cost IS NOT NULL');
      expect(priceListCallArg.values).toContain(tenantId);
      expect(priceListCallArg.values).toContain('job-spl');

      // Verify results:
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
      const mockQueryRaw = jest.fn();
      const client: UndoableBatchCheckClient = {
        $queryRaw: mockQueryRaw,
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
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it('marks price-list job as NOT undoable when all history rows have null old_cost', async () => {
      const mockQueryRaw = jest.fn().mockResolvedValueOnce([]); // no rows with old_cost not null
      const client: UndoableBatchCheckClient = {
        $queryRaw: mockQueryRaw,
      };

      const pageJobs = [
        {
          id: 'job-spl-first-ever',
          status: ImportJobStatus.APPLIED,
          entity_type: SUPPLIER_PRICE_LIST_ENTITY_TYPE,
        },
      ];

      const undoableIds = await findUndoableJobIds(client, tenantId, pageJobs);

      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      expect(undoableIds.has('job-spl-first-ever')).toBe(false);
      expect(undoableIds.size).toBe(0);
    });
  });
});
