import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Prisma,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { signCatalogHitPayload } from '../catalog/catalog-hit-payload';
import { WorkshopCatalogLineService } from './workshop-catalog-line.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ORDER_ID = '00000000-0000-0000-0000-000000000002';
const TASK_ID = '00000000-0000-0000-0000-000000000003';
const VEHICLE_ID = '00000000-0000-0000-0000-000000000004';
const BRAND_ID = 7;
const CATEGORY_ID = '00000000-0000-0000-0000-000000000005';

const task = {
  id: TASK_ID,
  tenant_id: TENANT_ID,
  workshop_order_id: ORDER_ID,
  line_items_version: 3,
  workshop_order: {
    status: WorkshopOrderStatus.INTAKE,
    purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
    vehicle_id: VEHICLE_ID,
  },
};

function createPartToken(overrides: Record<string, unknown> = {}): string {
  return signCatalogHitPayload({
    tenantId: TENANT_ID,
    workshopOrderId: ORDER_ID,
    vehicleId: VEHICLE_ID,
    taskId: TASK_ID,
    concern: 'PARTS',
    sourceSystem: 'tecdoc',
    externalId: 'external-part-1',
    name: 'Brake pad',
    articleNumber: 'BP-001',
    unitPrice: 79.99,
    brandLabel: 'Bosch',
    ean: '4012345678901',
    unit: 'pcs',
    fitmentNotes: 'Front axle',
    costPriceEst: null,
    oemNumbers: ['OEM-BP-001'],
    ...overrides,
  } as never);
}

function createLaborToken(overrides: Record<string, unknown> = {}): string {
  return signCatalogHitPayload({
    tenantId: TENANT_ID,
    workshopOrderId: ORDER_ID,
    vehicleId: VEHICLE_ID,
    taskId: TASK_ID,
    concern: 'LABOR',
    sourceSystem: 'haynes',
    externalId: 'external-labor-1',
    name: 'Brake inspection',
    externalOperationCode: 'HN-BRAKE',
    standardAw: 12,
    plannedHours: null,
    ...overrides,
  } as never);
}

describe('WorkshopCatalogLineService', () => {
  let service: WorkshopCatalogLineService;
  const mockPrisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    workshopTask: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    workshopTaskLineItem: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    catalogItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    brand: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    catalogProviderSettings: {
      findFirst: jest.fn(),
    },
    workshopOrder: {
      updateMany: jest.fn(),
    },
    laborCategory: {
      findFirst: jest.fn(),
    },
  };
  const mockTenantContext = {
    getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopCatalogLineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TenantContextService, useValue: mockTenantContext },
      ],
    }).compile();

    service = module.get(WorkshopCatalogLineService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        id: ORDER_ID,
        status: WorkshopOrderStatus.INTAKE,
        purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
      },
    ]);
    mockPrisma.workshopTask.findFirst.mockResolvedValue(task);
    mockPrisma.workshopTaskLineItem.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.workshopTaskLineItem.findFirst.mockResolvedValue(null);
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.catalogItem.findMany.mockResolvedValue([]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
  });

  it('rejects an invalid hit token with 401', async () => {
    await expect(
      service.addLineFromCatalog(ORDER_ID, TASK_ID, { hitToken: 'tampered' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('creates a part line and preserves a null signed cost', async () => {
    mockPrisma.brand.findFirst.mockResolvedValue({ id: BRAND_ID });
    mockPrisma.catalogItem.findFirst.mockResolvedValue(null);
    mockPrisma.catalogItem.create.mockResolvedValue({
      id: 'catalog-item-1',
      sku: 'tecdoc-BOSCH-BP-001-12345678',
    });
    mockPrisma.workshopTaskLineItem.create.mockResolvedValue({
      id: 'line-1',
      type: 'PART',
      item_no: 'tecdoc-BOSCH-BP-001-12345678',
      description: 'Brake pad',
      quantity: new Prisma.Decimal(1),
      unit_price: new Prisma.Decimal('79.99'),
      catalog_item_id: 'catalog-item-1',
      source_system: 'tecdoc',
      fitment_notes: 'Front axle',
      cost_price_est: null,
      oem_numbers: ['OEM-BP-001'],
      catalog_hit_jti: 'jti-1',
      part_execution_status: 'PENDING_PICK',
      external_operation_code: null,
      labor_category_id: null,
      hourly_rate_snapshot: null,
      standard_aw: null,
      actual_hours: null,
      internal_cost_rate: null,
    });

    const result = await service.addLineFromCatalog(ORDER_ID, TASK_ID, {
      hitToken: createPartToken(),
    });

    expect(mockPrisma.catalogItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cost_price: null,
          retail_price: new Prisma.Decimal('79.99'),
          source_system: 'tecdoc',
          external_article_id: 'external-part-1',
        }),
      }),
    );
    expect(mockPrisma.workshopTaskLineItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: new Prisma.Decimal(1),
          cost_price_est: null,
          catalog_item_id: 'catalog-item-1',
        }),
      }),
    );
    expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith({
      where: { id: TASK_ID, tenant_id: TENANT_ID },
      data: { line_items_version: { increment: 1 } },
    });
    expect(result.lineItemsVersion).toBe(4);
  });

  it('returns the existing line on same-token replay without incrementing version', async () => {
    const existingLine = {
      id: 'line-existing',
      type: 'PART',
      item_no: 'SKU-1',
      description: 'Brake pad',
      quantity: new Prisma.Decimal(1),
      unit_price: new Prisma.Decimal('79.99'),
      catalog_item_id: 'catalog-item-1',
      source_system: 'tecdoc',
      external_operation_code: null,
      fitment_notes: null,
      cost_price_est: null,
      oem_numbers: null,
      labor_category_id: null,
      hourly_rate_snapshot: null,
      catalog_hit_jti: 'jti-1',
      standard_aw: null,
      actual_hours: null,
      internal_cost_rate: null,
      part_execution_status: 'PENDING_PICK',
    };
    mockPrisma.workshopTaskLineItem.findFirst.mockResolvedValue(existingLine);

    const result = await service.addLineFromCatalog(ORDER_ID, TASK_ID, {
      hitToken: createPartToken(),
    });

    expect(result.line.id).toBe('line-existing');
    expect(result.lineItemsVersion).toBe(3);
    expect(mockPrisma.workshopTaskLineItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.workshopTaskLineItem.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.workshopOrder.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.workshopTask.updateMany).not.toHaveBeenCalledWith({
      where: { id: TASK_ID, tenant_id: TENANT_ID },
      data: { line_items_version: { increment: 1 } },
    });
  });

  it('updates an existing catalog item with a tenant-constrained predicate', async () => {
    mockPrisma.brand.findFirst.mockResolvedValue({ id: BRAND_ID });
    mockPrisma.catalogItem.findFirst.mockResolvedValue({
      id: 'catalog-item-existing',
      sku: 'SKU-EXISTING',
    });
    mockPrisma.catalogItem.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTaskLineItem.create.mockResolvedValue({
      id: 'line-existing-item',
      type: 'PART',
      item_no: 'SKU-EXISTING',
      description: 'Brake pad',
      quantity: new Prisma.Decimal(1),
      unit_price: new Prisma.Decimal('79.99'),
      catalog_item_id: 'catalog-item-existing',
      source_system: 'tecdoc',
      external_operation_code: null,
      fitment_notes: null,
      cost_price_est: null,
      oem_numbers: null,
      labor_category_id: null,
      hourly_rate_snapshot: null,
      catalog_hit_jti: 'jti-1',
      standard_aw: null,
      actual_hours: null,
      internal_cost_rate: null,
      part_execution_status: 'PENDING_PICK',
    });

    await service.addLineFromCatalog(ORDER_ID, TASK_ID, {
      hitToken: createPartToken(),
    });

    expect(mockPrisma.catalogItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'catalog-item-existing',
        tenant_id: TENANT_ID,
      },
      data: expect.objectContaining({
        retail_price: new Prisma.Decimal('79.99'),
      }),
    });
    expect(mockPrisma.catalogItem.update).not.toHaveBeenCalled();
  });

  it('rejects when an existing catalog item update loses its tenant-scoped match', async () => {
    mockPrisma.brand.findFirst.mockResolvedValue({ id: BRAND_ID });
    mockPrisma.catalogItem.findFirst.mockResolvedValue({
      id: 'catalog-item-existing',
      sku: 'SKU-EXISTING',
    });
    mockPrisma.catalogItem.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.addLineFromCatalog(ORDER_ID, TASK_ID, {
        hitToken: createPartToken(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['Citroën', 'CITROEN'],
    ['Škoda', 'SKODA'],
  ])('reuses a canonical brand for %s', async (brandLabel, normalizedName) => {
    mockPrisma.brand.findFirst.mockResolvedValue({ id: BRAND_ID });
    mockPrisma.catalogItem.findFirst.mockResolvedValue(null);
    mockPrisma.catalogItem.create.mockResolvedValue({
      id: 'catalog-item-1',
      sku: 'SKU-1',
    });
    mockPrisma.workshopTaskLineItem.create.mockResolvedValue({
      id: 'line-1',
      type: 'PART',
      item_no: 'SKU-1',
      description: 'Brake pad',
      quantity: new Prisma.Decimal(1),
      unit_price: new Prisma.Decimal('79.99'),
      catalog_item_id: 'catalog-item-1',
      source_system: 'tecdoc',
      external_operation_code: null,
      fitment_notes: null,
      cost_price_est: null,
      oem_numbers: null,
      labor_category_id: null,
      hourly_rate_snapshot: null,
      catalog_hit_jti: 'jti-1',
      standard_aw: null,
      actual_hours: null,
      internal_cost_rate: null,
      part_execution_status: 'PENDING_PICK',
    });

    await service.addLineFromCatalog(ORDER_ID, TASK_ID, {
      hitToken: createPartToken({ brandLabel }),
    });

    expect(mockPrisma.brand.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: TENANT_ID, normalized_name: normalizedName },
      select: { id: true },
    });
    expect(mockPrisma.brand.create).not.toHaveBeenCalled();
  });

  it('retries the whole transaction after a catalog-item unique conflict', async () => {
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '7.0.0' },
    );
    let transactionAttempts = 0;
    let transactionAborted = false;
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => unknown) => {
        transactionAttempts += 1;
        transactionAborted = false;
        return callback(mockPrisma);
      },
    );
    mockPrisma.brand.findFirst.mockResolvedValue(null);
    mockPrisma.brand.create.mockResolvedValue({ id: BRAND_ID });
    mockPrisma.catalogItem.findFirst.mockImplementation(async () => {
      if (transactionAborted) {
        throw new Error('current transaction is aborted');
      }
      return null;
    });
    mockPrisma.catalogItem.create
      .mockImplementationOnce(async () => {
        transactionAborted = true;
        throw uniqueViolation;
      })
      .mockResolvedValue({ id: 'catalog-item-1', sku: 'SKU-1' });
    mockPrisma.workshopTaskLineItem.create.mockResolvedValue({
      id: 'line-1',
      type: 'PART',
      item_no: 'SKU-1',
      description: 'Brake pad',
      quantity: new Prisma.Decimal(1),
      unit_price: new Prisma.Decimal('79.99'),
      catalog_item_id: 'catalog-item-1',
      source_system: 'tecdoc',
      external_operation_code: null,
      fitment_notes: null,
      cost_price_est: null,
      oem_numbers: null,
      labor_category_id: null,
      hourly_rate_snapshot: null,
      catalog_hit_jti: 'jti-1',
      standard_aw: null,
      actual_hours: null,
      internal_cost_rate: null,
      part_execution_status: 'PENDING_PICK',
    });

    await service.addLineFromCatalog(ORDER_ID, TASK_ID, {
      hitToken: createPartToken(),
    });

    expect(transactionAttempts).toBe(2);
    expect(mockPrisma.catalogItem.create).toHaveBeenCalledTimes(2);
  });

  it('rejects the add when the order becomes non-editable before the final guard', async () => {
    mockPrisma.brand.findFirst.mockResolvedValue({ id: BRAND_ID });
    mockPrisma.catalogItem.findFirst.mockResolvedValue(null);
    mockPrisma.catalogItem.create.mockResolvedValue({
      id: 'catalog-item-1',
      sku: 'SKU-1',
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        id: ORDER_ID,
        status: WorkshopOrderStatus.INVOICED,
        purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
      },
    ]);

    await expect(
      service.addLineFromCatalog(ORDER_ID, TASK_ID, {
        hitToken: createPartToken(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.workshopTaskLineItem.create).not.toHaveBeenCalled();
  });

  it('locks the current order status before replay detection', async () => {
    await service.addLineFromCatalog(ORDER_ID, TASK_ID, {
      hitToken: createPartToken(),
    });

    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(mockPrisma.workshopTaskLineItem.findFirst).toHaveBeenCalled();

    const [queryTemplate] = mockPrisma.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...string[],
    ];
    expect(Array.from(queryTemplate).join('')).toContain(
      'WHERE id =  AND tenant_id = ',
    );
    expect(Array.from(queryTemplate).join('')).not.toContain('::uuid');
  });

  it('checks both deterministic SKU candidates in one bounded query', async () => {
    mockPrisma.brand.findFirst.mockResolvedValue({ id: BRAND_ID });
    mockPrisma.catalogItem.findFirst.mockResolvedValue(null);
    mockPrisma.catalogItem.findMany.mockImplementation(async ({ where }) => [
      { sku: where.sku.in[0] },
    ]);
    mockPrisma.catalogItem.create.mockImplementation(async ({ data }) => ({
      id: 'catalog-item-fallback',
      sku: data.sku,
    }));
    mockPrisma.workshopTaskLineItem.create.mockResolvedValue({
      id: 'line-fallback',
      type: 'PART',
      item_no: 'SKU-FALLBACK',
      description: 'Brake pad',
      quantity: new Prisma.Decimal(1),
      unit_price: new Prisma.Decimal('79.99'),
      catalog_item_id: 'catalog-item-fallback',
      source_system: 'tecdoc',
      external_operation_code: null,
      fitment_notes: null,
      cost_price_est: null,
      oem_numbers: null,
      labor_category_id: null,
      hourly_rate_snapshot: null,
      catalog_hit_jti: 'jti-1',
      standard_aw: null,
      actual_hours: null,
      internal_cost_rate: null,
      part_execution_status: 'PENDING_PICK',
    });

    await service.addLineFromCatalog(ORDER_ID, TASK_ID, {
      hitToken: createPartToken(),
    });

    const skuQuery = mockPrisma.catalogItem.findMany.mock.calls[0][0];
    const candidates = skuQuery.where.sku.in as string[];
    expect(candidates).toHaveLength(2);
    expect(mockPrisma.catalogItem.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.catalogItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sku: candidates[1] }),
      }),
    );
  });

  it('returns a conflict when all bounded SKU candidates are occupied', async () => {
    mockPrisma.brand.findFirst.mockResolvedValue({ id: BRAND_ID });
    mockPrisma.catalogItem.findFirst.mockResolvedValue(null);
    mockPrisma.catalogItem.findMany.mockImplementation(async ({ where }) =>
      where.sku.in.map((sku: string) => ({ sku })),
    );

    await expect(
      service.addLineFromCatalog(ORDER_ID, TASK_ID, {
        hitToken: createPartToken(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.catalogItem.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.catalogItem.create).not.toHaveBeenCalled();
  });

  it('uses the requested labor category and converts AW to planned hours', async () => {
    mockPrisma.laborCategory.findFirst.mockResolvedValue({
      id: CATEGORY_ID,
      default_hourly_rate: new Prisma.Decimal(0),
      default_internal_cost_rate: null,
    });
    mockPrisma.workshopTaskLineItem.create.mockResolvedValue({
      id: 'labor-line-1',
      type: 'LABOR',
      item_no: 'HN-BRAKE',
      description: 'Brake inspection',
      quantity: new Prisma.Decimal('1.2'),
      unit_price: new Prisma.Decimal(0),
      catalog_item_id: null,
      source_system: 'haynes',
      external_operation_code: 'HN-BRAKE',
      fitment_notes: null,
      cost_price_est: null,
      oem_numbers: null,
      labor_category_id: CATEGORY_ID,
      hourly_rate_snapshot: new Prisma.Decimal(0),
      catalog_hit_jti: 'jti-2',
      standard_aw: new Prisma.Decimal(12),
      actual_hours: null,
      internal_cost_rate: null,
      part_execution_status: null,
    });
    mockPrisma.catalogProviderSettings.findFirst.mockResolvedValue({
      aw_minutes: 6,
      default_labor_category_id: null,
    });

    const result = await service.addLineFromCatalog(ORDER_ID, TASK_ID, {
      hitToken: createLaborToken(),
      laborCategoryId: CATEGORY_ID,
    });

    expect(mockPrisma.workshopTaskLineItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: new Prisma.Decimal('1.2'),
          unit_price: new Prisma.Decimal(0),
          labor_category_id: CATEGORY_ID,
          internal_cost_rate: null,
        }),
      }),
    );
    expect(result.lineItemsVersion).toBe(4);
  });

  it('preserves an explicitly zero planned labor duration', async () => {
    mockPrisma.laborCategory.findFirst.mockResolvedValue({
      id: CATEGORY_ID,
      default_hourly_rate: new Prisma.Decimal(0),
      default_internal_cost_rate: null,
    });
    mockPrisma.catalogProviderSettings.findFirst.mockResolvedValue({
      aw_minutes: 6,
      default_labor_category_id: null,
    });
    mockPrisma.workshopTaskLineItem.create.mockResolvedValue({
      id: 'labor-zero-line',
      type: 'LABOR',
      item_no: 'HN-BRAKE',
      description: 'Brake inspection',
      quantity: new Prisma.Decimal(0),
      unit_price: new Prisma.Decimal(0),
      catalog_item_id: null,
      source_system: 'haynes',
      external_operation_code: 'HN-BRAKE',
      fitment_notes: null,
      cost_price_est: null,
      oem_numbers: null,
      labor_category_id: CATEGORY_ID,
      hourly_rate_snapshot: new Prisma.Decimal(0),
      catalog_hit_jti: 'jti-2',
      standard_aw: new Prisma.Decimal(12),
      actual_hours: null,
      internal_cost_rate: null,
      part_execution_status: null,
    });

    await service.addLineFromCatalog(ORDER_ID, TASK_ID, {
      hitToken: createLaborToken({ plannedHours: 0 }),
      laborCategoryId: CATEGORY_ID,
    });

    expect(mockPrisma.workshopTaskLineItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: new Prisma.Decimal(0),
          unit_price: new Prisma.Decimal(0),
          internal_cost_rate: null,
        }),
      }),
    );
  });

  it('retries the whole transaction after a serializable write conflict', async () => {
    const writeConflict = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock',
      { code: 'P2034', clientVersion: '7.0.0' },
    );
    const replayedResult = {
      line: { id: 'line-replayed' },
      lineItemsVersion: 3,
    };
    mockPrisma.$transaction
      .mockRejectedValueOnce(writeConflict)
      .mockResolvedValueOnce(replayedResult);

    await expect(
      service.addLineFromCatalog(ORDER_ID, TASK_ID, {
        hitToken: createPartToken(),
      }),
    ).resolves.toEqual(replayedResult);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects an explicitly requested inactive labor category', async () => {
    mockPrisma.laborCategory.findFirst.mockResolvedValue(null);

    await expect(
      service.addLineFromCatalog(ORDER_ID, TASK_ID, {
        hitToken: createLaborToken(),
        laborCategoryId: CATEGORY_ID,
      }),
    ).rejects.toThrow('Labor category must have a selling rate');

    expect(mockPrisma.laborCategory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ is_active: true }),
      }),
    );
  });

  it('rejects an inactive configured default labor category', async () => {
    mockPrisma.catalogProviderSettings.findFirst.mockResolvedValue({
      aw_minutes: 6,
      default_labor_category_id: CATEGORY_ID,
    });
    mockPrisma.laborCategory.findFirst.mockResolvedValue(null);

    await expect(
      service.addLineFromCatalog(ORDER_ID, TASK_ID, {
        hitToken: createLaborToken(),
      }),
    ).rejects.toThrow('Labor category must have a selling rate');

    expect(mockPrisma.laborCategory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ is_active: true }),
      }),
    );
  });

  it('rejects a valid token bound to another task with 409', async () => {
    const otherTaskToken = createPartToken({ taskId: 'other-task' });

    await expect(
      service.addLineFromCatalog(ORDER_ID, TASK_ID, {
        hitToken: otherTaskToken,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
