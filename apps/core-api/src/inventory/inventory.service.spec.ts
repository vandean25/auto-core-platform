import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
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
        { provide: TenantContextService, useValue: { getTenantId: jest.fn().mockResolvedValue('tenant-1') } },
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
        brand: { name: 'Bosch' },
        stocks: [
          {
            quantity_on_hand: 10,
            quantity_reserved: 2,
          },
        ],
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
        brand: { name: 'Bosch' },
        stocks: [
          {
            quantity_on_hand: 5,
            quantity_reserved: 1,
          },
        ],
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
      const mockItems = [
        {
          id: '1',
          sku: 'SKU-1',
          name: 'Item 1',
          brand: { name: 'Brand 1' },
          brand_id: 1,
          retail_price: 100,
          stocks: [
            {
              quantity_on_hand: 10,
              quantity_reserved: 2,
              location: { name: 'Loc 1' },
            },
          ],
          superseded_by: null,
        },
        {
          id: '2',
          sku: 'SKU-2',
          name: 'Item 2',
          brand: { name: 'Brand 2' },
          brand_id: 2,
          retail_price: 200,
          stocks: [],
          superseded_by: { id: '3' },
        },
      ];
      (prisma.catalogItem.findMany as jest.Mock).mockResolvedValue(mockItems);
      (prisma.catalogItem.count as jest.Mock).mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result).toEqual({
        data: [
          {
            id: '1',
            sku: 'SKU-1',
            name: 'Item 1',
            brand: 'Brand 1',
            brand_id: 1,
            price: 100,
            status: 'IN_STOCK',
            quantity_available: 8,
            warehouse_location: 'Loc 1',
          },
          {
            id: '2',
            sku: 'SKU-2',
            name: 'Item 2',
            brand: 'Brand 2',
            brand_id: 2,
            price: 200,
            status: 'SUPERSEDED',
            quantity_available: 0,
            warehouse_location: 'N/A',
          },
        ],
        meta: {
          total: 2,
          page: 1,
          pageSize: 10,
          pageCount: 1,
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
            tenant_id: 'tenant-1',
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
              { brand: { name: { contains: search, mode: 'insensitive' } } },
            ],
          },
        }),
      );
    });

    it('should filter by location', async () => {
      const location = 'Tire Hotel';
      await service.findAll({ page: 1, limit: 10, location });

      expect(prisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: 'tenant-1',
            stocks: {
              some: {
                location: {
                  name: { contains: location, mode: 'insensitive' },
                },
              },
            },
          },
          include: expect.objectContaining({
            stocks: expect.objectContaining({
              include: expect.objectContaining({
                location: true,
              }),
            }),
          }),
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
      expect(result.meta.pageCount).toBe(1);
    });
  });
});
