import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import { FinanceService } from '../../finance/finance.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SalesOrderService } from './sales-order.service.js';

describe('SalesOrderService', () => {
  let service: SalesOrderService;

  const mockPrisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    catalogItem: {
      count: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
    },
    salesOrder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    vehicle: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    tenantMember: {
      findFirst: jest.fn(),
    },
    siteMembership: {
      findFirst: jest.fn(),
    },
  };

  const transactionContext = {
    $queryRaw: jest.fn(),
    financeSettings: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    salesOrder: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    salesOrderItem: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };

  const mockFinance = {
    validateTransactionDate: jest.fn(),
  };

  const mockSiteContext = {
    getSiteId: jest.fn().mockResolvedValue('site-1'),
    listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
  };

  const mockTenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest.fn().mockReturnValue({ userId: 'fb-user-1' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrderService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FinanceService, useValue: mockFinance },
        {
          provide: TenantContextService,
          useValue: mockTenantContext,
        },
        {
          provide: SiteContextService,
          useValue: mockSiteContext,
        },
      ],
    }).compile();

    service = module.get<SalesOrderService>(SalesOrderService);
    jest.clearAllMocks();
  });

  it('does not expose identity resolution state from created sales order vehicles', async () => {
    const vehicle = {
      id: 'vehicle-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
    };
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });
    transactionContext.$queryRaw.mockResolvedValue([
      { id: 'site-1', is_active: true },
    ]);
    transactionContext.financeSettings.upsert.mockResolvedValue({});
    transactionContext.financeSettings.update.mockResolvedValue({
      sales_order_prefix: 'SO-2026-',
      next_sales_order_number: 1002,
    });
    mockPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback(transactionContext),
    );
    transactionContext.salesOrder.create.mockResolvedValue({
      id: 'so-1',
      vehicle,
    });

    const result = await service.create({
      customer_id: 'customer-1',
      items: [],
    });

    expect(result.vehicle).not.toHaveProperty('identity_resolution_generation');
    expect(result.vehicle).not.toHaveProperty('identity_resolution_token');
  });

  it('does not expose identity resolution state from listed sales order vehicles', async () => {
    const vehicle = {
      id: 'vehicle-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
    };
    mockPrisma.salesOrder.findMany.mockResolvedValue([{ id: 'so-1', vehicle }]);
    mockPrisma.salesOrder.count.mockResolvedValue(1);

    const result = await service.findAll();

    expect(result.data[0].vehicle).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.data[0].vehicle).not.toHaveProperty(
      'identity_resolution_token',
    );
  });

  it('findAll uses paginated query path when prisma args are provided', async () => {
    mockPrisma.salesOrder.findMany.mockResolvedValue([
      { id: 'so-1', vehicle: null },
    ]);
    mockPrisma.salesOrder.count.mockResolvedValue(5);

    const result = await service.findAll({
      where: { status: SalesOrderStatus.DRAFT },
      skip: 10,
      take: 10,
    });

    expect(mockPrisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: SalesOrderStatus.DRAFT,
          tenant_id: 'tenant-1',
          site_id: 'site-1',
        },
        skip: 10,
        take: 10,
      }),
    );
    expect(mockPrisma.salesOrder.count).toHaveBeenCalledWith({
      where: {
        status: SalesOrderStatus.DRAFT,
        tenant_id: 'tenant-1',
        site_id: 'site-1',
      },
    });
    expect(result.total).toBe(5);
  });

  it('findAll filters by status when a status string is provided', async () => {
    mockPrisma.salesOrder.findMany.mockResolvedValue([
      { id: 'so-1', vehicle: null },
    ]);

    await service.findAll(SalesOrderStatus.CONFIRMED);

    expect(mockPrisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: 'tenant-1',
          site_id: 'site-1',
          status: SalesOrderStatus.CONFIRMED,
        },
      }),
    );
    expect(mockPrisma.salesOrder.count).not.toHaveBeenCalled();
  });

  it('does not expose identity resolution state from sales order detail vehicles', async () => {
    const vehicle = {
      id: 'vehicle-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
    };
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      vehicle,
    });

    const result = await service.findOne('so-1');

    expect(result.vehicle).not.toHaveProperty('identity_resolution_generation');
    expect(result.vehicle).not.toHaveProperty('identity_resolution_token');
  });

  it('deletes sales order only when it is DRAFT and has no invoice', async () => {
    mockPrisma.salesOrder.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.remove('so-1')).resolves.toEqual({ id: 'so-1' });
    expect(mockPrisma.salesOrder.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'so-1',
        tenant_id: 'tenant-1',
        status: SalesOrderStatus.DRAFT,
        invoice: null,
      },
    });
  });

  it('blocks delete when atomic condition does not match', async () => {
    mockPrisma.salesOrder.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('so-1')).rejects.toThrow(BadRequestException);
    expect(mockPrisma.salesOrder.deleteMany).toHaveBeenCalled();
  });

  it('replaces items and recalculates total when update payload includes items', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'so-1',
      site_id: 'site-1',
      total_amount: new Prisma.Decimal(20),
      items: [],
    });

    mockPrisma.catalogItem.count.mockResolvedValue(1);
    transactionContext.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    transactionContext.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      total_amount: new Prisma.Decimal(30),
      items: [],
    });
    mockPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback(transactionContext),
    );

    await service.update('so-1', {
      items: [
        {
          catalog_item_id: 'item-1',
          description: 'Oil Filter',
          quantity: 3,
          unit_price: 10,
          tax_rate: 20,
        },
      ],
    });

    expect(transactionContext.salesOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total_amount: new Prisma.Decimal(30),
        }),
      }),
    );
    expect(transactionContext.salesOrderItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sales_order_id: 'so-1',
          catalog_item_id: 'item-1',
        }),
      ],
    });
  });

  it('guards sales-order status transitions with expected-from status', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      site_id: 'site-1',
      status: SalesOrderStatus.DRAFT,
      total_amount: new Prisma.Decimal(20),
      items: [],
    });
    transactionContext.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    transactionContext.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
      items: [],
    });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'site-1', is_active: true }]);
    mockPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback(transactionContext),
    );

    await service.update('so-1', { status: SalesOrderStatus.CONFIRMED });

    expect(transactionContext.salesOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'so-1',
          tenant_id: 'tenant-1',
          site_id: 'site-1',
          status: SalesOrderStatus.DRAFT,
        },
        data: expect.objectContaining({
          status: SalesOrderStatus.CONFIRMED,
        }),
      }),
    );
  });

  it('returns 409 when a sales-order status transition is stale', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      site_id: 'site-1',
      status: SalesOrderStatus.DRAFT,
      total_amount: new Prisma.Decimal(20),
      items: [],
    });
    transactionContext.salesOrder.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'site-1', is_active: true }]);
    mockPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback(transactionContext),
    );

    await expect(
      service.update('so-1', { status: SalesOrderStatus.CONFIRMED }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not write status on field-only sales order updates', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      site_id: 'site-1',
      status: SalesOrderStatus.DRAFT,
      total_amount: new Prisma.Decimal(20),
      items: [],
    });
    transactionContext.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    transactionContext.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.DRAFT,
      items: [],
    });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'site-1', is_active: true }]);
    mockPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback(transactionContext),
    );

    await service.update('so-1', { notes: 'Call customer' });

    const data = transactionContext.salesOrder.updateMany.mock.calls[0][0]
      .data as Record<string, unknown>;
    expect(data).not.toHaveProperty('status');
  });

  it('rejects sales-order status skips that are not adjacent transitions', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      site_id: 'site-1',
      status: SalesOrderStatus.DRAFT,
      total_amount: new Prisma.Decimal(20),
      items: [],
    });

    await expect(
      service.update('so-1', { status: SalesOrderStatus.INVOICED }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects replacement items that omit catalog_item_id', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'so-1',
      site_id: 'site-1',
      total_amount: new Prisma.Decimal(20),
      items: [],
    });

    await expect(
      service.update('so-1', {
        items: [
          {
            description: 'Oil Filter',
            quantity: 3,
            unit_price: 10,
            tax_rate: 20,
          },
        ],
      }),
    ).rejects.toThrow('Each sales order item must include catalog_item_id');

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  describe('guarded retargeting', () => {
    it('retargets sales order when in DRAFT and caller has target site membership', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        id: 'so-1',
        site_id: 'site-1',
        status: SalesOrderStatus.DRAFT,
        total_amount: new Prisma.Decimal(20),
        items: [],
      });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-internal-1' });
      mockPrisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      mockPrisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-2' });

      transactionContext.$queryRaw.mockResolvedValue([
        { id: 'site-1', is_active: true },
        { id: 'site-2', is_active: true },
      ]);
      transactionContext.salesOrder.updateMany.mockResolvedValue({ count: 1 });
      transactionContext.salesOrder.findFirst.mockResolvedValue({
        id: 'so-1',
        site_id: 'site-2',
        status: SalesOrderStatus.DRAFT,
        items: [],
      });
      mockPrisma.$transaction.mockImplementation(async (callback: any) =>
        callback(transactionContext),
      );

      const result = await service.update('so-1', {
        siteId: 'site-2',
        expectedSiteId: 'site-1',
      });

      expect(transactionContext.salesOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'so-1',
            tenant_id: 'tenant-1',
            site_id: 'site-1',
            status: SalesOrderStatus.DRAFT,
          }),
          data: expect.objectContaining({
            site_id: 'site-2',
          }),
        }),
      );
      expect(transactionContext.salesOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'so-1',
            tenant_id: 'tenant-1',
            site_id: 'site-2',
          },
        }),
      );
      expect(result.site_id).toBe('site-2');
    });

    it('rejects retargeting if sales order is not in DRAFT status with 422', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        id: 'so-1',
        site_id: 'site-1',
        status: SalesOrderStatus.CONFIRMED,
        total_amount: new Prisma.Decimal(20),
        items: [],
      });

      await expect(
        service.update('so-1', { siteId: 'site-2' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects retargeting if caller lacks active target site membership with 422', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        id: 'so-1',
        site_id: 'site-1',
        status: SalesOrderStatus.DRAFT,
        total_amount: new Prisma.Decimal(20),
        items: [],
      });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-internal-1' });
      mockPrisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      mockPrisma.siteMembership.findFirst.mockResolvedValue(null);

      await expect(
        service.update('so-1', { siteId: 'site-2' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects retargeting with 409 if expectedSiteId does not match current site', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        id: 'so-1',
        site_id: 'site-1',
        status: SalesOrderStatus.DRAFT,
        total_amount: new Prisma.Decimal(20),
        items: [],
      });

      await expect(
        service.update('so-1', {
          siteId: 'site-2',
          expectedSiteId: 'site-other',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
