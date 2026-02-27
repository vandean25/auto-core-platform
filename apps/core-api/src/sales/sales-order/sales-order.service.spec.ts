import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SalesOrderStatus } from '@prisma/client';
import { FinanceService } from '../../finance/finance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesOrderService } from './sales-order.service';

describe('SalesOrderService', () => {
  let service: SalesOrderService;

  const mockPrisma = {
    salesOrder: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
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
});
