import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { TenantContextService } from '../../common/services/tenant-context.service';
import { FinanceService } from '../../finance/finance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesOrderService } from './sales-order.service';

describe('SalesOrderService', () => {
  let service: SalesOrderService;

  const mockPrisma = {
    $transaction: jest.fn(),
    catalogItem: {
      count: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
    },
    salesOrder: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    vehicle: {
      findFirst: jest.fn(),
    },
  };

  const transactionContext = {
    salesOrder: {
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrderService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FinanceService, useValue: mockFinance },
        {
          provide: TenantContextService,
          useValue: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
        },
      ],
    }).compile();

    service = module.get<SalesOrderService>(SalesOrderService);
    jest.clearAllMocks();
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

  it('rejects replacement items that omit catalog_item_id', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'so-1',
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
});
