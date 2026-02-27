import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    mockPrisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.DRAFT,
      invoice: null,
      items: [],
    });
    mockPrisma.salesOrder.delete.mockResolvedValue({ id: 'so-1' });

    await service.remove('so-1');

    expect(mockPrisma.salesOrder.delete).toHaveBeenCalledWith({
      where: { id: 'so-1' },
    });
  });

  it('blocks delete when invoice exists', async () => {
    mockPrisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.DRAFT,
      invoice: { id: 'inv-1' },
      items: [],
    });

    await expect(service.remove('so-1')).rejects.toThrow(BadRequestException);
  });

  it('blocks delete when status is not DRAFT', async () => {
    mockPrisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
      invoice: null,
      items: [],
    });

    await expect(service.remove('so-1')).rejects.toThrow(BadRequestException);
  });

  it('throws not found for missing sales order', async () => {
    mockPrisma.salesOrder.findUnique.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
  });
});

