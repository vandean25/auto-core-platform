import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BrandService } from './brand.service';
import {
  ConflictError,
  NotFoundError,
} from '../common/errors/application-errors';

// ---------------------------------------------------------------------------
// Mock the repository at the correct layer. We inject a minimal PrismaService
// and then replace the private `brandRepository` field with our mock so the
// service tests verify error-mapping logic without coupling to Prisma internals.
// ---------------------------------------------------------------------------

const mockRepository = {
  findMany: jest.fn(),
  findManyPaginated: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
};

// Cross-entity dependency checks use raw PrismaService — these stay as
// Prisma-level mocks intentionally (see C4 boundary rule).
const mockPrisma = {
  brand: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  catalogItem: { count: jest.fn() },
  vendor: { count: jest.fn() },
};

describe('BrandService', () => {
  let service: BrandService;

  beforeEach(() => {
    service = new BrandService(mockPrisma as unknown as PrismaService);
    // Replace the private repository with our mock
    (service as any).brandRepository = mockRepository;
    jest.clearAllMocks();
  });

  // ── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all brands wrapped in PaginatedResult when no pagination params', async () => {
      const mockBrands = [{ id: 1, name: 'Toyota' }];
      mockRepository.findMany.mockResolvedValue(mockBrands);

      const result = await service.findAll();

      expect(result).toEqual({
        data: mockBrands,
        meta: { total: 1, page: 1, limit: 1, totalPages: 1 },
      });
      expect(mockRepository.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { name: 'asc' },
      });
    });

    it('delegates to findManyPaginated when page is provided', async () => {
      const paginatedResponse = {
        data: [{ id: 1, name: 'Toyota' }],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };
      mockRepository.findManyPaginated.mockResolvedValue(paginatedResponse);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result).toEqual(paginatedResponse);
      expect(mockRepository.findManyPaginated).toHaveBeenCalledWith({
        where: {},
        orderBy: { name: 'asc' },
        page: 1,
        limit: 10,
      });
    });

    it('passes isVehicleMake filter correctly', async () => {
      mockRepository.findMany.mockResolvedValue([]);

      await service.findAll({ isVehicleMake: true });

      expect(mockRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isVehicleMake: true },
        }),
      );
    });

    it('passes isPartManufacturer filter correctly', async () => {
      mockRepository.findMany.mockResolvedValue([]);

      await service.findAll({ isPartManufacturer: false });

      expect(mockRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isPartManufacturer: false },
        }),
      );
    });

    it('returns empty array wrapped in PaginatedResult', async () => {
      mockRepository.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 0, totalPages: 1 },
      });
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns a brand if found', async () => {
      const mockBrand = { id: 1, name: 'Toyota' };
      mockRepository.findById.mockResolvedValue(mockBrand);

      const result = await service.findOne(1);

      expect(result).toEqual(mockBrand);
      expect(mockRepository.findById).toHaveBeenCalledWith(1);
    });

    it('bubbles up NotFoundError', async () => {
      mockRepository.findById.mockRejectedValue(
        new NotFoundError('Record with ID 999 not found'),
      );

      await expect(service.findOne(999)).rejects.toThrow(NotFoundError);
    });

    it('rethrows unknown errors without mapping', async () => {
      const unknownError = new Error('Connection timed out');
      mockRepository.findById.mockRejectedValue(unknownError);

      await expect(service.findOne(1)).rejects.toThrow('Connection timed out');
    });
  });

  // ── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a brand successfully', async () => {
      const dto = {
        name: 'Toyota',
        isVehicleMake: true,
        isPartManufacturer: false,
      };
      const mockBrand = { id: 1, ...dto };
      mockRepository.create.mockResolvedValue(mockBrand);

      const result = await service.create(dto as any);

      expect(result).toEqual(mockBrand);
    });

    it('throws BadRequestException if neither type is true', async () => {
      const dto = {
        name: 'Toyota',
        isVehicleMake: false,
        isPartManufacturer: false,
      };

      await expect(service.create(dto as any)).rejects.toThrow(
        BadRequestException,
      );
      // Repository should NOT be called if validation fails
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('bubbles up ConflictError on duplicate name', async () => {
      const dto = {
        name: 'Toyota',
        isVehicleMake: true,
        isPartManufacturer: false,
      };
      mockRepository.create.mockRejectedValue(
        new ConflictError('Unique constraint violated on: name', 'name'),
      );

      await expect(service.create(dto as any)).rejects.toThrow(ConflictError);
    });
  });

  // ── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates a brand successfully (name only, no flag validation)', async () => {
      const dto = { name: 'Toyota Updated' };
      const mockBrand = { id: 1, name: 'Toyota Updated', isVehicleMake: true };
      mockRepository.update.mockResolvedValue(mockBrand);

      const result = await service.update(1, dto);

      expect(result).toEqual(mockBrand);
      // findById should NOT be called since no flags are being updated
      expect(mockRepository.findById).not.toHaveBeenCalled();
    });

    it('updates logoUrl only without triggering flag validation', async () => {
      const dto = { logoUrl: 'https://example.com/logo.png' };
      const mockBrand = {
        id: 1,
        name: 'Toyota',
        logoUrl: 'https://example.com/logo.png',
      };
      mockRepository.update.mockResolvedValue(mockBrand);

      const result = await service.update(1, dto);

      expect(result).toEqual(mockBrand);
      expect(mockRepository.findById).not.toHaveBeenCalled();
    });

    it('validates flags if isVehicleMake is being set to false (last remaining flag)', async () => {
      mockRepository.findById.mockResolvedValue({
        id: 1,
        isVehicleMake: true,
        isPartManufacturer: false,
      });

      await expect(service.update(1, { isVehicleMake: false })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows update when at least one flag remains true', async () => {
      mockRepository.findById.mockResolvedValue({
        id: 1,
        isVehicleMake: true,
        isPartManufacturer: true,
      });
      mockRepository.update.mockResolvedValue({
        id: 1,
        isVehicleMake: false,
        isPartManufacturer: true,
      });

      const result = await service.update(1, { isVehicleMake: false });

      expect(result.isPartManufacturer).toBe(true);
    });

    it('bubbles up NotFoundError', async () => {
      mockRepository.update.mockRejectedValue(
        new NotFoundError('Record with ID 999 not found'),
      );

      await expect(service.update(999, { name: 'New' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('bubbles up ConflictError', async () => {
      mockRepository.update.mockRejectedValue(
        new ConflictError('Unique constraint violated on: name', 'name'),
      );

      await expect(service.update(1, { name: 'Existing' })).rejects.toThrow(
        ConflictError,
      );
    });
  });

  // ── remove ────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes successfully if no dependencies', async () => {
      mockPrisma.catalogItem.count.mockResolvedValue(0);
      mockPrisma.vendor.count.mockResolvedValue(0);
      mockRepository.delete.mockResolvedValue({ id: 1 });

      await service.remove(1);

      expect(mockRepository.delete).toHaveBeenCalledWith(1);
    });

    it('throws ConflictException if catalog items linked', async () => {
      mockPrisma.catalogItem.count.mockResolvedValue(5);

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      // Repository delete should NOT be called
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException if vendors linked', async () => {
      mockPrisma.catalogItem.count.mockResolvedValue(0);
      mockPrisma.vendor.count.mockResolvedValue(2);

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });

    it('bubbles up NotFoundError on delete', async () => {
      mockPrisma.catalogItem.count.mockResolvedValue(0);
      mockPrisma.vendor.count.mockResolvedValue(0);
      mockRepository.delete.mockRejectedValue(
        new NotFoundError('Record with ID 1 not found'),
      );

      await expect(service.remove(1)).rejects.toThrow(NotFoundError);
    });
  });
});
