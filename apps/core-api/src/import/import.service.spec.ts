import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AuditLogAction,
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { ImportService } from './import.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DecisionUseCaseHooksService } from '../decision/decision-use-case-hooks.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';

describe('ImportService - Supplier Price List', () => {
  let service: ImportService;

  const mockPrisma: any = {
    user: {
      findUnique: jest.fn(),
    },
    tenantMember: {
      findFirst: jest.fn(),
    },
    vendor: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    marginRule: {
      findMany: jest.fn(),
    },
    brand: {
      findMany: jest.fn(),
    },
    financeSettings: {
      findFirst: jest.fn(),
    },
    catalogItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    vendorArticle: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    catalogPriceHistory: {
      create: jest.fn(),
    },
    importJob: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    importJobRow: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
  };

  const mockTenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      userId: 'user-admin-uid',
      role: 'ADMIN',
      email: 'admin@example.com',
    }),
  };

  const mockDecisionHooks = {
    scheduleCustomerImportDryRunShadows: jest.fn(),
  };

  const mockRequestContext = {
    getTraceId: jest.fn().mockReturnValue('trace-123'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: DecisionUseCaseHooksService, useValue: mockDecisionHooks },
        { provide: RequestContextService, useValue: mockRequestContext },
      ],
    }).compile();

    service = module.get<ImportService>(ImportService);
    jest.clearAllMocks();

    mockTenantContext.getTenantId.mockResolvedValue('tenant-1');
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'user-admin-uid',
      role: 'ADMIN',
      email: 'admin@example.com',
    });

    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-db-id' });
    mockPrisma.tenantMember.findFirst.mockResolvedValue({ id: 'member-db-id' });
  });

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
      mockPrisma.vendor.findFirst.mockResolvedValue(null);
      mockPrisma.vendor.findMany.mockResolvedValue([]);

      await expect(
        service.createDryRunFromUpload({
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

      expect(mockPrisma.vendor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: 'tenant-1' }),
        }),
      );
    });

    it('runs dry run with matching, margin calculation, and price jump flagging', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue({
        id: 'vendor-1',
        name: 'Autoteile Partner',
      });
      mockPrisma.vendor.findMany.mockResolvedValue([
        {
          id: 'vendor-1',
          name: 'Autoteile Partner',
        },
      ]);
      mockPrisma.marginRule.findMany.mockResolvedValue([
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
      mockPrisma.brand.findMany.mockResolvedValue([]);
      mockPrisma.financeSettings.findFirst.mockResolvedValue({
        price_jump_threshold_percent: new Prisma.Decimal(20),
      });

      // Item 1 matches by EAN (old cost: 20 -> new cost 50 is a 150% jump!)
      // Item 2 unmatched
      mockPrisma.catalogItem.findMany.mockResolvedValue([
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
      mockPrisma.vendorArticle.findMany.mockResolvedValue([]);

      mockPrisma.importJob.create.mockImplementation(({ data }: any) => ({
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

      const result = await service.createDryRunFromUpload({
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

      expect(mockPrisma.importJob.create).toHaveBeenCalled();
      const createdCall = mockPrisma.importJob.create.mock.calls[0][0];

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
      mockPrisma.importJob.findFirst.mockResolvedValue({
        id: 'job-1',
        tenant_id: 'tenant-1',
        entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
        source_system: 'vendor-1',
        status: ImportJobStatus.DRY_RUN_DONE,
        options_json: { vendor_id: 'vendor-1' },
      });

      mockPrisma.importJobRow.findMany.mockResolvedValue([
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

      await expect(service.applyJob('job-1')).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: IMPORT_ERROR_CODES.PRICE_JUMP_REQUIRES_ACCEPTANCE,
          }),
        }),
      );
    });

    it('succeeds when accept_all_price_jumps is true and executes atomic transaction', async () => {
      mockPrisma.importJob.findFirst.mockResolvedValue({
        id: 'job-1',
        tenant_id: 'tenant-1',
        entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
        source_system: 'vendor-1',
        status: ImportJobStatus.DRY_RUN_DONE,
        options_json: { vendor_id: 'vendor-1' },
      });
      mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'vendor-1', name: 'Vendor 1' });
      mockPrisma.vendorArticle.findFirst.mockResolvedValue(null);

      mockPrisma.importJobRow.findMany.mockResolvedValue([
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

      mockPrisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cost_price: new Prisma.Decimal(50),
        retail_price: new Prisma.Decimal(80),
      });

      mockPrisma.catalogItem.create.mockResolvedValue({
        id: 'item-2',
        sku: 'ART-200',
        name: 'New Oil Filter',
      });

      mockPrisma.importJob.update.mockResolvedValue({
        id: 'job-1',
        status: ImportJobStatus.APPLIED,
        totals_json: { rows: 2, create: 1, update: 1, skip: 0, error: 0 },
        createdAt: new Date(),
        appliedAt: new Date(),
      });

      const result = await service.applyJob('job-1', {
        accept_all_price_jumps: true,
      });

      // UPDATE verification
      expect(mockPrisma.catalogItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { cost_price: 100, retail_price: 150 },
      });
      expect(mockPrisma.catalogPriceHistory.create).toHaveBeenCalledWith({
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
      expect(mockPrisma.vendorArticle.upsert).toHaveBeenCalledWith({
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
      expect(mockPrisma.catalogItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          sku: 'ART-200',
          name: 'New Oil Filter',
          cost_price: 15,
          retail_price: 25,
        }),
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
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
      mockPrisma.importJob.findFirst.mockResolvedValue({
        id: 'job-idempotent',
        tenant_id: 'tenant-1',
        entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
        source_system: 'vendor-1',
        status: ImportJobStatus.DRY_RUN_DONE,
        options_json: { vendor_id: 'vendor-1' },
      });
      mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'vendor-1', name: 'Vendor 1' });

      mockPrisma.importJobRow.findMany.mockResolvedValue([
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
      ]);

      mockPrisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cost_price: new Prisma.Decimal(50),
        retail_price: new Prisma.Decimal(80),
      });

      mockPrisma.importJob.update.mockResolvedValue({
        id: 'job-idempotent',
        status: ImportJobStatus.APPLIED,
        totals_json: { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
        createdAt: new Date(),
        appliedAt: new Date(),
      });

      const result = await service.applyJob('job-idempotent');

      // Prices unchanged: CatalogItem not updated, no CatalogPriceHistory created
      expect(mockPrisma.catalogItem.update).not.toHaveBeenCalled();
      expect(mockPrisma.catalogPriceHistory.create).not.toHaveBeenCalled();

      // But VendorArticle IS upserted
      expect(mockPrisma.vendorArticle.upsert).toHaveBeenCalledWith({
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
      mockPrisma.importJob.findFirst.mockResolvedValue({
        id: 'job-accepted-rows',
        tenant_id: 'tenant-1',
        entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
        source_system: 'vendor-1',
        status: ImportJobStatus.DRY_RUN_DONE,
        options_json: { vendor_id: 'vendor-1' },
      });
      mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'vendor-1', name: 'Vendor 1' });

      mockPrisma.importJobRow.findMany.mockResolvedValue([
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
      ]);

      mockPrisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cost_price: new Prisma.Decimal(50),
        retail_price: new Prisma.Decimal(100),
      });

      mockPrisma.importJob.update.mockResolvedValue({
        id: 'job-accepted-rows',
        status: ImportJobStatus.APPLIED,
        totals_json: { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
        createdAt: new Date(),
        appliedAt: new Date(),
      });

      // Passing accepted_row_numbers: [5] accepts row 5
      const result = await service.applyJob('job-accepted-rows', {
        accepted_row_numbers: [5],
      });

      expect(result.status).toBe(ImportJobStatus.APPLIED);
      expect(mockPrisma.catalogPriceHistory.create).toHaveBeenCalled();
    });

    it('fails when accepted_row_numbers does not include a flagged row', async () => {
      mockPrisma.importJob.findFirst.mockResolvedValue({
        id: 'job-partial',
        tenant_id: 'tenant-1',
        entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
        source_system: 'vendor-1',
        status: ImportJobStatus.DRY_RUN_DONE,
        options_json: { vendor_id: 'vendor-1' },
      });

      mockPrisma.importJobRow.findMany.mockResolvedValue([
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
        service.applyJob('job-partial', {
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

      const arrangeApply = (jobId: string, rows: unknown[]) => {
        mockPrisma.importJob.findFirst.mockResolvedValue({
          id: jobId,
          tenant_id: 'tenant-1',
          entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
          source_system: 'vendor-1',
          status: ImportJobStatus.DRY_RUN_DONE,
          options_json: { vendor_id: 'vendor-1' },
        });
        mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.vendor.findFirst.mockResolvedValue({
          id: 'vendor-1',
          name: 'Vendor 1',
        });
        mockPrisma.vendorArticle.findFirst.mockResolvedValue(null);
        mockPrisma.vendorArticle.upsert.mockResolvedValue({});
        mockPrisma.catalogPriceHistory.create.mockResolvedValue({});
        mockPrisma.importJobRow.findMany.mockResolvedValue(rows);
        mockPrisma.importJobRow.update.mockResolvedValue({});
        mockPrisma.auditLog.create.mockResolvedValue({});
        mockPrisma.importJob.update.mockImplementation(
          async ({ data }: any) => ({
            id: jobId,
            status: data.status,
            totals_json: data.totals_json,
            createdAt: new Date(),
            appliedAt: data.appliedAt ?? null,
          }),
        );
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
        mockPrisma.catalogItem.create.mockImplementation(
          async ({ data }: any) => {
            if (data.sku === 'ART-DUPLICATE') {
              throw uniqueViolation();
            }
            return { id: `item-${data.sku}`, sku: data.sku, name: data.name };
          },
        );

        const result = await service.applyJob('job-chunk');

        const expectedTotals = {
          rows: 5,
          create: 2,
          update: 0,
          skip: 1,
          error: 2,
        };
        expect(result.totals).toEqual(expectedTotals);
        expect(mockPrisma.importJob.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: ImportJobStatus.APPLIED,
              totals_json: expectedTotals,
            }),
          }),
        );
        expect(mockPrisma.importJobRow.update).toHaveBeenCalledWith({
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
        mockPrisma.catalogItem.create.mockImplementation(
          async ({ data }: any) => {
            if (data.sku === 'ART-CONN-2') {
              throw new Error('Connection lost');
            }
            return { id: `item-${data.sku}`, sku: data.sku, name: data.name };
          },
        );

        await expect(service.applyJob('job-conn-lost')).rejects.toThrow(
          'Connection lost',
        );

        expect(mockPrisma.importJob.updateMany).toHaveBeenCalledWith({
          where: { id: 'job-conn-lost', status: ImportJobStatus.APPLYING },
          data: {
            status: ImportJobStatus.FAILED,
            totals_json: { rows: 2, create: 1, update: 0, skip: 0, error: 0 },
          },
        });
        expect(mockPrisma.importJob.update).not.toHaveBeenCalledWith(
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
          .spyOn(service as any, 'serializeJob')
          .mockImplementation(() => {
            throw new Error('serialization failed');
          });

        await expect(service.applyJob('job-post-apply')).rejects.toThrow(
          'serialization failed',
        );

        expect(mockPrisma.importJob.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: ImportJobStatus.APPLIED }),
          }),
        );
        const failedWrites = [
          ...mockPrisma.importJob.update.mock.calls,
          ...mockPrisma.importJob.updateMany.mock.calls,
        ].filter(
          ([args]: any[]) => args?.data?.status === ImportJobStatus.FAILED,
        );
        expect(failedWrites).toEqual([]);
        serializeSpy.mockRestore();
      });
    });
  });
});
