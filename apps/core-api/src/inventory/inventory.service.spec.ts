import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: PrismaService;

  const mockPrismaService = {
    catalogItem: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAvailability', () => {
    it('should return stock for a part that is not superseded', async () => {
      mockPrismaService.catalogItem.findUnique.mockResolvedValue({
        sku: 'PART-A',
        name: 'Brake Pad',
        brand: 'Bosch',
        stock: {
          quantity_on_hand: 10,
          quantity_reserved: 2,
        },
        superseded_by: null,
      });

      const result = await service.checkAvailability('PART-A');

      expect(result).toEqual({
        sku: 'PART-A',
        name: 'Brake Pad',
        brand: 'Bosch',
        quantity_on_hand: 10,
        quantity_reserved: 2,
        quantity_available: 8,
        is_superseded: false,
      });
    });

    it('should recursively follow supersessions', async () => {
      const partA = {
        sku: 'PART-A',
        superseded_by: { sku: 'PART-B' },
      };
      const partB = {
        sku: 'PART-B',
        name: 'New Brake Pad',
        brand: 'Bosch',
        stock: {
          quantity_on_hand: 5,
          quantity_reserved: 1,
        },
        superseded_by: null,
      };

      mockPrismaService.catalogItem.findUnique
        .mockResolvedValueOnce(partA)
        .mockResolvedValueOnce(partB);

      const result = await service.checkAvailability('PART-A');

      expect(result).toEqual({
        sku: 'PART-B',
        name: 'New Brake Pad',
        brand: 'Bosch',
        quantity_on_hand: 5,
        quantity_reserved: 1,
        quantity_available: 4,
        original_sku: 'PART-A',
        suggested_sku: 'PART-B',
        is_superseded: true,
      });
    });

    it('should throw NotFoundException if SKU does not exist', async () => {
      mockPrismaService.catalogItem.findUnique.mockResolvedValue(null);

      await expect(service.checkAvailability('UNKNOWN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated items with meta data', async () => {
      const mockItems = [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }];
      (prisma.catalogItem.findMany as jest.Mock).mockResolvedValue(mockItems);
      (prisma.catalogItem.count as jest.Mock).mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result).toEqual({
        data: mockItems,
        meta: {
          total: 2,
          page: 1,
          last_page: 1,
        },
      });
      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });

    it('should support fuzzy search across name, sku, and brand', async () => {
      const search = 'bosch';
      await service.findAll({ page: 1, limit: 10, search });

      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
              { brand: { contains: search, mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('should filter by location and filter the included stock', async () => {
      const location = 'Tire Hotel';
      await service.findAll({ page: 1, limit: 10, location });

      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            stock: {
              location: {
                name: { contains: location, mode: 'insensitive' },
              },
            },
          },
          include: {
            stock: {
              where: {
                location: {
                  name: { contains: location, mode: 'insensitive' },
                },
              },
            },
          },
        }),
      );
    });

    it('should return empty data for out of range page', async () => {
      (prisma.catalogItem.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.catalogItem.count as jest.Mock).mockResolvedValue(10);

      const result = await service.findAll({ page: 5, limit: 10 });

      expect(result.data).toEqual([]);
      expect(result.meta.page).toBe(5);
      expect(result.meta.total).toBe(10);
      expect(result.meta.last_page).toBe(1);
    });
  });
});
