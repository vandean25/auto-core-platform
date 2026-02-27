import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { VendorService } from './vendor.service';

describe('VendorService', () => {
  let service: VendorService;

  const mockPrisma = {
    vendor: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    purchaseOrder: {
      count: jest.fn(),
    },
    purchaseInvoice: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VendorService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<VendorService>(VendorService);
    jest.clearAllMocks();
  });

  it('deletes vendor when unlinked', async () => {
    mockPrisma.vendor.findUnique.mockResolvedValue({ id: 'v-1' });
    mockPrisma.purchaseOrder.count.mockResolvedValue(0);
    mockPrisma.purchaseInvoice.count.mockResolvedValue(0);
    mockPrisma.vendor.delete.mockResolvedValue({ id: 'v-1' });

    await service.remove('v-1');

    expect(mockPrisma.vendor.delete).toHaveBeenCalledWith({
      where: { id: 'v-1' },
    });
  });

  it('blocks delete when purchase records are linked', async () => {
    mockPrisma.vendor.findUnique.mockResolvedValue({ id: 'v-1' });
    mockPrisma.purchaseOrder.count.mockResolvedValue(1);
    mockPrisma.purchaseInvoice.count.mockResolvedValue(0);

    await expect(service.remove('v-1')).rejects.toThrow(BadRequestException);
  });

  it('throws not found when vendor is missing', async () => {
    mockPrisma.vendor.findUnique.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
  });
});

