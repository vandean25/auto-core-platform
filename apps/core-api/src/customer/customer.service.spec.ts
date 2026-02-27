import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerService } from './customer.service';

describe('CustomerService', () => {
  let service: CustomerService;

  const mockPrisma = {
    customer: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    salesOrder: { count: jest.fn() },
    invoice: { count: jest.fn() },
    workshopOrder: { count: jest.fn() },
    vehicle: { count: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
    jest.clearAllMocks();
  });

  it('deletes customer when no linked business records exist', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 'c-1' });
    mockPrisma.salesOrder.count.mockResolvedValue(0);
    mockPrisma.invoice.count.mockResolvedValue(0);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.vehicle.count.mockResolvedValue(0);
    mockPrisma.customer.delete.mockResolvedValue({ id: 'c-1' });

    await service.remove('c-1');

    expect(mockPrisma.customer.delete).toHaveBeenCalledWith({
      where: { id: 'c-1' },
    });
  });

  it('blocks delete when orders/invoices/workshop orders are linked', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 'c-1' });
    mockPrisma.salesOrder.count.mockResolvedValue(1);
    mockPrisma.invoice.count.mockResolvedValue(0);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.vehicle.count.mockResolvedValue(0);

    await expect(service.remove('c-1')).rejects.toThrow(BadRequestException);
  });

  it('blocks delete when vehicles are linked', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 'c-1' });
    mockPrisma.salesOrder.count.mockResolvedValue(0);
    mockPrisma.invoice.count.mockResolvedValue(0);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.vehicle.count.mockResolvedValue(2);

    await expect(service.remove('c-1')).rejects.toThrow(BadRequestException);
  });

  it('throws not found when customer does not exist', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
  });
});

