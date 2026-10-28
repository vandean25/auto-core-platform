import {
  AuditLogAction,
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { setupImportHarness } from './import.service.spec.support.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';

describe('ImportService - Supplier Price List', () => {
  const h = setupImportHarness();

  function bindApplyJob(
    job: Record<string, unknown>,
    rows: Array<Record<string, unknown>>,
  ) {
    const state: {
      job: Record<string, unknown>;
      rows: Array<Record<string, unknown>>;
    } = {
      job: {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        appliedAt: null,
        ...job,
      },
      rows: rows.map((row, index) => ({
        apply_seq: index + 1,
        ...row,
      })),
    };
    h.prisma.importJob.findFirst.mockImplementation(async () => state.job);
    h.prisma.importJob.updateMany.mockImplementation(async ({ where, data }: any) => {
      const expected = where?.status;
      if (typeof expected === 'string' && state.job.status !== expected) {
        return { count: 0 };
      }
      Object.assign(state.job, data);
      return { count: 1 };
    });
    h.prisma.importJob.update.mockImplementation(async ({ data }: any) => {
      Object.assign(state.job, data);
      return state.job;
    });
    h.prisma.importJobRow.findMany.mockImplementation(async (args?: any) => {
      const minSeq = args?.where?.apply_seq?.gt ?? 0;
      const action = args?.where?.action;
      return state.rows.filter((row) => {
        const seq = typeof row.apply_seq === 'number' ? row.apply_seq : 0;
        return seq > minSeq && (!action || row.action === action);
      });
    });
    h.prisma.importJobRow.findFirst = jest.fn(async () => state.rows.at(-1) ?? null);
    h.prisma.importJobRow.count = jest.fn(async (args?: any) => {
      const action = args?.where?.action;
      return state.rows.filter((row) => !action || row.action === action).length;
    });
    h.prisma.importJobRow.update.mockImplementation(async (args: any) => {
      const rowNo = args.where?.tenant_id_import_job_id_row_no?.row_no;
      const row = state.rows.find((item) => item.row_no === rowNo);
      if (row && args.data?.action) row.action = args.data.action;
      return row ?? {};
    });
  }

  describe('createDryRunFromUpload for SUPPLIER_PRICE_LIST', () => {
    const validCsv = Buffer.from(
      'Lieferanten-Artikelnummer;Beschreibung;Einkaufspreis;UVP;EAN\n' +
        'ART-100;Bremsscheibe vorne;50,00;100,00;4012345678901\n' +
        'ART-200;Ölfilter;10,00;20,00;4098765432109\n',
    );

    const file = {
      buffer: validCsv,
      originalname: 'supplier-prices.csv',
      size: validCsv.length,
    } as Express.Multer.File;

    it('throws SUPPLIER_VENDOR_REQUIRED if vendor is not found for tenant', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue(null);
      h.prisma.vendor.findMany.mockResolvedValue([]);

      await expect(
        h.service.createDryRunFromUpload({
          file,
          entityType: ImportEntityType.SUPPLIER_PRICE_LIST,
          sourceSystem: 'non-existent-vendor',
          mappingJson: {
            supplier_article_no: 'Lieferanten-Artikelnummer',
            description: 'Beschreibung',
            cost_price: 'Einkaufspreis',
          },
          optionsJson: {},
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: IMPORT_ERROR_CODES.SUPPLIER_VENDOR_REQUIRED,
          }),
        }),
      );

      expect(h.prisma.vendor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: 'tenant-1' }),
        }),
      );
    });

    it('runs dry run with matching, margin calculation, and price jump flagging', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue({
        id: 'vendor-1',
        name: 'Autoteile Partner',
      });
      h.prisma.vendor.findMany.mockResolvedValue([
        {
          id: 'vendor-1',
          name: 'Autoteile Partner',
        },
      ]);
      h.prisma.marginRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          priority: 1,
          brand_id: null,
          revenue_group_id: null,
          cost_min: null,
          cost_max: null,
          markup_percent: new Prisma.Decimal(50),
          use_supplier_rrp: false,
          rounding: 'ROUND_90',
          is_active: true,
        },
      ]);
      h.prisma.brand.findMany.mockResolvedValue([]);
      h.prisma.financeSettings.findFirst.mockResolvedValue({
        price_jump_threshold_percent: new Prisma.Decimal(20),
      });

      // Item 1 matches by EAN (old cost: 20 -> new cost 50 is a 150% jump!)
      // Item 2 unmatched
      h.prisma.catalogItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          sku: 'SKU-001',
          name: 'Bremsscheibe',
          cost_price: new Prisma.Decimal(20),
          retail_price: new Prisma.Decimal(40),
          ean: '4012345678901',
          brand_id: null,
          revenue_group_id: null,
        },
      ]);
      h.prisma.vendorArticle.findMany.mockResolvedValue([]);

      h.prisma.importJob.create.mockImplementation(({ data }: any) => ({
        id: 'job-1',
        entity_type: data.entity_type,
        source_system: data.source_system,
        file_name: data.file_name,
        file_sha256: data.file_sha256,
        status: data.status,
        mapping_json: data.mapping_json,
        options_json: data.options_json,
        totals_json: data.totals_json,
        created_by: data.created_by,
        createdAt: new Date(),
        appliedAt: null,
      }));

      const result = await h.service.createDryRunFromUpload({
        file,
        entityType: ImportEntityType.SUPPLIER_PRICE_LIST,
        sourceSystem: 'vendor-1',
        mappingJson: {
          supplier_article_no: 'Lieferanten-Artikelnummer',
          description: 'Beschreibung',
          cost_price: 'Einkaufspreis',
          rrp: 'UVP',
          ean: 'EAN',
        },
        optionsJson: {
          create_new_catalog_items: true,
        },
      });

      expect(h.prisma.importJob.create).toHaveBeenCalled();
      const createdCall = h.prisma.importJob.create.mock.calls[0][0];

      // Item 1 is UPDATE (price jump flagged), Item 2 is CREATE
      expect(createdCall.data.totals_json).toEqual({
        rows: 2,
        create: 1,
        update: 1,
        skip: 0,
        error: 0,
        flagged_jumps: 1,
      });

      const row1 = createdCall.data.rows.create[0];
      expect(row1.action).toBe(ImportRowAction.UPDATE);
      expect(row1.normalized_json.price_jump_flagged).toBe(true);

      const row2 = createdCall.data.rows.create[1];
      expect(row2.action).toBe(ImportRowAction.CREATE);
    });
  });

  describe('applyJob for SUPPLIER_PRICE_LIST', () => {
    it('throws PRICE_JUMP_REQUIRES_ACCEPTANCE when flagged row is not accepted', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue({
        id: 'job-1',
        tenant_id: 'tenant-1',
        entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
        source_system: 'vendor-1',
        status: ImportJobStatus.DRY_RUN_DONE,
        options_json: { vendor_id: 'vendor-1' },
      });

      h.prisma.importJobRow.findMany.mockResolvedValue([
        {
          tenant_id: 'tenant-1',
          import_job_id: 'job-1',
          row_no: 1,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-1',
          external_id: 'ART-100',
          normalized_json: {
            supplier_article_no: 'ART-100',
            price_jump_flagged: true,
            cost_price: 100,
            retail_price: 150,
          },
        },
      ]);

      await expect(h.service.applyJob('job-1')).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: IMPORT_ERROR_CODES.PRICE_JUMP_REQUIRES_ACCEPTANCE,
          }),
        }),
      );
    });

    it('succeeds when accept_all_price_jumps is true and executes atomic transaction', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue({
        id: 'vendor-1',
        name: 'Vendor 1',
      });
      h.prisma.vendorArticle.findFirst.mockResolvedValue(null);

      bindApplyJob(
        {
          id: 'job-1',
          tenant_id: 'tenant-1',
          entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
          source_system: 'vendor-1',
          status: ImportJobStatus.DRY_RUN_DONE,
          options_json: { vendor_id: 'vendor-1' },
          totals_json: { rows: 2, create: 1, update: 1, skip: 0, error: 0 },
        },
        [
        {
          tenant_id: 'tenant-1',
          import_job_id: 'job-1',
          row_no: 1,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-1',
          external_id: 'ART-100',
          normalized_json: {
            supplier_article_no: 'ART-100',
            price_jump_flagged: true,
            cost_price: 100,
            retail_price: 150,
            rrp: 180,
          },
        },
        {
          tenant_id: 'tenant-1',
          import_job_id: 'job-1',
          row_no: 2,
          action: ImportRowAction.CREATE,
          entity_id: null,
          external_id: 'ART-200',
          normalized_json: {
            supplier_article_no: 'ART-200',
            description: 'New Oil Filter',
            cost_price: 15,
            retail_price: 25,
            rrp: 30,
            unit: 'pcs',
            ean: '4000000000',
          },
        },
      ]);

      h.prisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cost_price: new Prisma.Decimal(50),
        retail_price: new Prisma.Decimal(80),
      });

      h.prisma.catalogItem.create.mockResolvedValue({
        id: 'item-2',
        sku: 'ART-200',
        name: 'New Oil Filter',
      });

      const result = await h.service.applyJob('job-1', {
        accept_all_price_jumps: true,
      });

      // UPDATE verification
      expect(h.prisma.catalogItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { cost_price: 100, retail_price: 150 },
      });
      expect(h.prisma.catalogPriceHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          catalog_item_id: 'item-1',
          old_cost: 50,
          new_cost: 100,
          old_retail: 80,
          new_retail: 150,
          import_job_id: 'job-1',
        }),
      });
      expect(h.prisma.vendorArticle.upsert).toHaveBeenCalledWith({
        where: {
          tenant_id_vendor_id_vendor_article_no: {
            tenant_id: 'tenant-1',
            vendor_id: 'vendor-1',
            vendor_article_no: 'ART-100',
          },
        },
        create: expect.objectContaining({
          tenant_id: 'tenant-1',
          vendor_id: 'vendor-1',
          catalog_item_id: 'item-1',
          vendor_article_no: 'ART-100',
          last_cost: 100,
          last_rrp: 180,
        }),
        update: expect.objectContaining({
          catalog_item_id: 'item-1',
          last_cost: 100,
          last_rrp: 180,
        }),
      });

      // CREATE verification
      expect(h.prisma.catalogItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          sku: 'ART-200',
          name: 'New Oil Filter',
          cost_price: 15,
          retail_price: 25,
        }),
      });

      expect(h.prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: 'tenant-1',
            entity_type: 'ImportJob',
            entity_id: 'job-1',
            action: AuditLogAction.UPDATE,
          }),
        }),
      );

      expect(result.status).toBe(ImportJobStatus.APPLIED);
    });

    it('is idempotent: when prices are unchanged, skips CatalogItem update and CatalogPriceHistory, but upserts VendorArticle', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue({
        id: 'vendor-1',
        name: 'Vendor 1',
      });

      bindApplyJob(
        {
          id: 'job-idempotent',
          tenant_id: 'tenant-1',
          entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
          source_system: 'vendor-1',
          status: ImportJobStatus.DRY_RUN_DONE,
          options_json: { vendor_id: 'vendor-1' },
          totals_json: { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
        },
        [
        {
          tenant_id: 'tenant-1',
          import_job_id: 'job-idempotent',
          row_no: 1,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-1',
          external_id: 'ART-100',
          normalized_json: {
            supplier_article_no: 'ART-100',
            price_jump_flagged: false,
            cost_price: 50, // same as DB
            retail_price: 80, // same as DB
            rrp: 100,
          },
        },
        ],
      );

      h.prisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cost_price: new Prisma.Decimal(50),
        retail_price: new Prisma.Decimal(80),
      });

      const result = await h.service.applyJob('job-idempotent');

      // Prices unchanged: CatalogItem not updated, no CatalogPriceHistory created
      expect(h.prisma.catalogItem.update).not.toHaveBeenCalled();
      expect(h.prisma.catalogPriceHistory.create).not.toHaveBeenCalled();

      // But VendorArticle IS upserted
      expect(h.prisma.vendorArticle.upsert).toHaveBeenCalledWith({
        where: {
          tenant_id_vendor_id_vendor_article_no: {
            tenant_id: 'tenant-1',
            vendor_id: 'vendor-1',
            vendor_article_no: 'ART-100',
          },
        },
        create: expect.objectContaining({
          tenant_id: 'tenant-1',
          vendor_id: 'vendor-1',
          catalog_item_id: 'item-1',
          vendor_article_no: 'ART-100',
          last_cost: 50,
          last_rrp: 100,
        }),
        update: expect.objectContaining({
          catalog_item_id: 'item-1',
          last_cost: 50,
          last_rrp: 100,
        }),
      });

      expect(result.status).toBe(ImportJobStatus.APPLIED);
    });

    it('succeeds when all flagged rows are in accepted_row_numbers', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue({
        id: 'vendor-1',
        name: 'Vendor 1',
      });

      bindApplyJob(
        {
          id: 'job-accepted-rows',
          tenant_id: 'tenant-1',
          entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
          source_system: 'vendor-1',
          status: ImportJobStatus.DRY_RUN_DONE,
          options_json: { vendor_id: 'vendor-1' },
          totals_json: { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
        },
        [
        {
          tenant_id: 'tenant-1',
          import_job_id: 'job-accepted-rows',
          row_no: 5,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-1',
          external_id: 'ART-500',
          normalized_json: {
            supplier_article_no: 'ART-500',
            price_jump_flagged: true,
            cost_price: 150,
            retail_price: 250,
          },
        },
        ],
      );

      h.prisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cost_price: new Prisma.Decimal(50),
        retail_price: new Prisma.Decimal(100),
      });

      // Passing accepted_row_numbers: [5] accepts row 5
      const result = await h.service.applyJob('job-accepted-rows', {
        accepted_row_numbers: [5],
      });

      expect(result.status).toBe(ImportJobStatus.APPLIED);
      expect(h.prisma.catalogPriceHistory.create).toHaveBeenCalled();
    });

    it('fails when accepted_row_numbers does not include a flagged row', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue({
        id: 'job-partial',
        tenant_id: 'tenant-1',
        entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
        source_system: 'vendor-1',
        status: ImportJobStatus.DRY_RUN_DONE,
        options_json: { vendor_id: 'vendor-1' },
      });

      h.prisma.importJobRow.findMany.mockResolvedValue([
        {
          tenant_id: 'tenant-1',
          import_job_id: 'job-partial',
          row_no: 1,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-1',
          external_id: 'ART-1',
          normalized_json: {
            supplier_article_no: 'ART-1',
            price_jump_flagged: true,
            cost_price: 100,
            retail_price: 150,
          },
        },
        {
          tenant_id: 'tenant-1',
          import_job_id: 'job-partial',
          row_no: 2,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-2',
          external_id: 'ART-2',
          normalized_json: {
            supplier_article_no: 'ART-2',
            price_jump_flagged: true,
            cost_price: 200,
            retail_price: 300,
          },
        },
      ]);

      // Only row 1 accepted, row 2 not accepted -> throws
      await expect(
        h.service.applyJob('job-partial', {
          accepted_row_numbers: [1],
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: IMPORT_ERROR_CODES.PRICE_JUMP_REQUIRES_ACCEPTANCE,
          }),
        }),
      );
    });

    describe('chunk failures and job bookkeeping', () => {
      const createRow = (rowNo: number, sku: string) => ({
        tenant_id: 'tenant-1',
        import_job_id: 'job-chunk',
        row_no: rowNo,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: sku,
        normalized_json: {
          supplier_article_no: sku,
          description: `Item ${sku}`,
          cost_price: 10,
          retail_price: 20,
          rrp: null,
          unit: 'pcs',
          ean: null,
        },
      });

      const arrangeApply = (jobId: string, rows: Array<Record<string, unknown>>) => {
        bindApplyJob(
          {
            id: jobId,
            tenant_id: 'tenant-1',
            entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
            source_system: 'vendor-1',
            status: ImportJobStatus.DRY_RUN_DONE,
            options_json: { vendor_id: 'vendor-1' },
            totals_json: {
              rows: rows.length,
              create: rows.filter((row) => row.action === ImportRowAction.CREATE)
                .length,
              update: 0,
              skip: rows.filter((row) => row.action === ImportRowAction.SKIP)
                .length,
              error: rows.filter((row) => row.action === ImportRowAction.ERROR)
                .length,
            },
          },
          rows,
        );
        h.prisma.vendor.findFirst.mockResolvedValue({
          id: 'vendor-1',
          name: 'Vendor 1',
        });
        h.prisma.vendorArticle.findFirst.mockResolvedValue(null);
        h.prisma.vendorArticle.upsert.mockResolvedValue({});
        h.prisma.catalogPriceHistory.create.mockResolvedValue({});
        const rowActions = new Map<number, ImportRowAction>();
        for (const row of rows as Array<{
          row_no: number;
          action: ImportRowAction;
        }>) {
          rowActions.set(row.row_no, row.action);
        }
        h.prisma.importJobRow.update.mockImplementation(
          async (args: {
            where?: {
              tenant_id_import_job_id_row_no?: { row_no?: number };
            };
            data?: { action?: ImportRowAction };
          }) => {
            const rowNo = args.where?.tenant_id_import_job_id_row_no?.row_no;
            if (args.data?.action && rowNo !== undefined) {
              rowActions.set(rowNo, args.data.action);
            }
            return {};
          },
        );
        h.prisma.$transaction.mockImplementation(
          (callback: (tx: unknown) => unknown) =>
            callback(
              withApplyPersistedTotalsTransactionClient(h.prisma, {
                tenantId: 'tenant-1',
                expectedRows: rows.length,
                actionsByRow: rowActions,
              }),
            ),
        );
        h.prisma.auditLog.create.mockResolvedValue({});
      };

      const uniqueViolation = () =>
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '0',
        });

      it('counts each row once when a chunk fails and its rows are re-applied one by one', async () => {
        arrangeApply('job-chunk', [
          createRow(1, 'ART-NEW-1'),
          { ...createRow(2, 'ART-SKIP-2'), action: ImportRowAction.SKIP },
          { ...createRow(3, 'ART-ERROR-3'), action: ImportRowAction.ERROR },
          createRow(4, 'ART-DUPLICATE'),
          createRow(5, 'ART-NEW-5'),
        ]);
        h.prisma.catalogItem.create.mockImplementation(
          async ({ data }: any) => {
            if (data.sku === 'ART-DUPLICATE') {
              throw uniqueViolation();
            }
            return { id: `item-${data.sku}`, sku: data.sku, name: data.name };
          },
        );

        const result = await h.service.applyJob('job-chunk');

        const expectedTotals = {
          rows: 5,
          create: 2,
          update: 0,
          skip: 1,
          error: 2,
        };
        expect(result.totals).toEqual(expectedTotals);
        expect(h.prisma.importJob.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: ImportJobStatus.APPLIED,
              totals_json: expectedTotals,
            }),
          }),
        );
        expect(h.prisma.importJobRow.update).toHaveBeenCalledWith({
          where: {
            tenant_id_import_job_id_row_no: {
              tenant_id: 'tenant-1',
              import_job_id: 'job-chunk',
              row_no: 4,
            },
          },
          data: {
            action: ImportRowAction.ERROR,
            errors_json: [
              {
                code: IMPORT_ERROR_CODES.APPLY_FAILED,
                message: 'Row failed during apply',
              },
            ],
          },
        });
      });

      it('surfaces non row-level errors and ends the job FAILED with the committed totals', async () => {
        arrangeApply('job-conn-lost', [
          createRow(1, 'ART-OK-1'),
          createRow(2, 'ART-CONN-2'),
        ]);
        h.prisma.catalogItem.create.mockImplementation(
          async ({ data }: any) => {
            if (data.sku === 'ART-CONN-2') {
              throw new Error('Connection lost');
            }
            return { id: `item-${data.sku}`, sku: data.sku, name: data.name };
          },
        );

        await expect(h.service.applyJob('job-conn-lost')).rejects.toThrow(
          'Connection lost',
        );

        expect(h.prisma.importJob.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'job-conn-lost', status: ImportJobStatus.APPLYING },
            data: expect.objectContaining({
              status: ImportJobStatus.FAILED,
              totals_json: { rows: 2, create: 1, update: 0, skip: 0, error: 0 },
            }),
          }),
        );
        expect(h.prisma.importJob.update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: ImportJobStatus.APPLIED }),
          }),
        );
      });

      it('does not mark the job FAILED when bookkeeping fails after it was APPLIED', async () => {
        arrangeApply('job-post-apply', [
          { ...createRow(1, 'ART-SKIP-1'), action: ImportRowAction.SKIP },
        ]);
        const serializeSpy = jest
          .spyOn(h.service as any, 'serializeJob')
          .mockImplementation(() => {
            throw new Error('serialization failed');
          });

        await expect(h.service.applyJob('job-post-apply')).rejects.toThrow(
          'serialization failed',
        );

        const failedWrites = [
          ...h.prisma.importJob.update.mock.calls,
          ...h.prisma.importJob.updateMany.mock.calls,
        ].filter(
          ([args]: any[]) => args?.data?.status === ImportJobStatus.FAILED,
        );
        expect(
          failedWrites.every(
            ([args]: any[]) => args?.where?.status === ImportJobStatus.APPLYING,
          ),
        ).toBe(true);
        serializeSpy.mockRestore();
      });

    });
  });
});
