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
import { TenantContextService } from '../common/services/tenant-context.service';

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
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  catalogItem: { count: jest.fn() },
  vendor: { count: jest.fn() },
};

const mockTenantContext = {
  getTenantId: jest.fn().mockResolvedValue('test-tenant-id'),
};

describe('BrandService', () => {
  let service: BrandService;

  beforeEach(() => {
    service = new BrandService(
      mockPrisma as unknown as PrismaService,
      mockTenantContext as unknown as TenantContextService,
    );
    // Replace the private repository with our mock
    (service as any).brandRepository = mockRepository;
    jest.clearAllMocks();
    mockTenantContext.getTenantId.mockResolvedValue('test-tenant-id');
  });

  it('resolves the brand delegate lazily after construction', async () => {
    const delayedPrisma = {
      brand: undefined,
      catalogItem: { count: jest.fn() },
      vendor: { count: jest.fn() },
    };

    const delayedService = new BrandService(
      delayedPrisma as unknown as PrismaService,
      mockTenantContext as unknown as TenantContextService,
    );

    delayedPrisma.brand = {
      findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Audi' }]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    };

    const result = await delayedService.findAll();

    expect(result.data).toEqual([{ id: 1, name: 'Audi' }]);
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
        where: { tenant_id: 'test-tenant-id' },
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
        where: { tenant_id: 'test-tenant-id' },
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
          where: { tenant_id: 'test-tenant-id', isVehicleMake: true },
        }),
      );
    });

    it('passes isPartManufacturer filter correctly', async () => {
      mockRepository.findMany.mockResolvedValue([]);

      await service.findAll({ isPartManufacturer: false });

      expect(mockRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'test-tenant-id', isPartManufacturer: false },
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
      const mockBrand = { id: 1, name: 'Toyota', tenant_id: 'test-tenant-id' };
      mockPrisma.brand.findFirst.mockResolvedValue(mockBrand);

      const result = await service.findOne(1);

      expect(result).toEqual(mockBrand);
      expect(mockPrisma.brand.findFirst).toHaveBeenCalledWith({
        where: { id: 1, tenant_id: 'test-tenant-id' },
      });
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('rethrows unknown errors without mapping', async () => {
      const unknownError = new Error('Connection timed out');
      mockPrisma.brand.findFirst.mockRejectedValue(unknownError);

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

      const result = await service.create(dto);

      expect(result).toEqual(mockBrand);
      expect(mockRepository.create).toHaveBeenCalledWith({
        ...dto,
        tenant_id: 'test-tenant-id',
      });
    });

    it('throws BadRequestException if neither type is true', async () => {
      const dto = {
        name: 'Toyota',
        isVehicleMake: false,
        isPartManufacturer: false,
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      // Repository should NOT be called if validation fails
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('maps ConflictError to ConflictException on duplicate name', async () => {
      const dto = {
        name: 'Toyota',
        isVehicleMake: true,
        isPartManufacturer: false,
      };
      mockRepository.create.mockRejectedValue(
        new ConflictError('Unique constraint violated on: name', 'name'),
      );

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates a brand successfully (name only, no flag validation)', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 1,
        name: 'Toyota',
        isVehicleMake: true,
        tenant_id: 'test-tenant-id',
      });
      const dto = { name: 'Toyota Updated' };
      const mockBrand = { id: 1, name: 'Toyota Updated', isVehicleMake: true };
      mockRepository.update.mockResolvedValue(mockBrand);

      const result = await service.update(1, dto);

      expect(result).toEqual(mockBrand);
      // findFirst should be called for finding the brand before update
      expect(mockPrisma.brand.findFirst).toHaveBeenCalledWith({
        where: { id: 1, tenant_id: 'test-tenant-id' },
      });
    });

    it('updates logoUrl only without triggering flag validation', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 1,
        name: 'Toyota',
        isVehicleMake: true,
        tenant_id: 'test-tenant-id',
      });
      const dto = { logoUrl: 'https://example.com/logo.png' };
      const mockBrand = {
        id: 1,
        name: 'Toyota',
        logoUrl: 'https://example.com/logo.png',
      };
      mockRepository.update.mockResolvedValue(mockBrand);

      const result = await service.update(1, dto);

      expect(result).toEqual(mockBrand);
      expect(mockPrisma.brand.findFirst).toHaveBeenCalledWith({
        where: { id: 1, tenant_id: 'test-tenant-id' },
      });
    });

    it('validates flags if isVehicleMake is being set to false (last remaining flag)', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 1,
        isVehicleMake: true,
        isPartManufacturer: false,
        tenant_id: 'test-tenant-id',
      });

      await expect(service.update(1, { isVehicleMake: false })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows update when at least one flag remains true', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 1,
        isVehicleMake: true,
        isPartManufacturer: true,
        tenant_id: 'test-tenant-id',
      });
      mockRepository.update.mockResolvedValue({
        id: 1,
        isVehicleMake: false,
        isPartManufacturer: true,
      });

      const result = await service.update(1, { isVehicleMake: false });

      expect(result.isPartManufacturer).toBe(true);
    });

    it('throws NotFoundException if update target missing', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue(null);

      await expect(service.update(999, { name: 'New' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('maps ConflictError to ConflictException', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 1,
        tenant_id: 'test-tenant-id',
        isVehicleMake: true,
        isPartManufacturer: false,
      });
      mockRepository.update.mockRejectedValue(
        new ConflictError('Unique constraint violated on: name', 'name'),
      );

      await expect(service.update(1, { name: 'Existing' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── remove ────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes successfully if no dependencies', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 1,
        tenant_id: 'test-tenant-id',
      });
      mockPrisma.catalogItem.count.mockResolvedValue(0);
      mockPrisma.vendor.count.mockResolvedValue(0);
      mockRepository.delete.mockResolvedValue({ id: 1 });

      await service.remove(1);

      expect(mockRepository.delete).toHaveBeenCalledWith(1);
    });

    it('throws ConflictException if catalog items linked', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 1,
        tenant_id: 'test-tenant-id',
      });
      mockPrisma.catalogItem.count.mockResolvedValue(5);

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      // Repository delete should NOT be called
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException if vendors linked', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({
        id: 1,
        tenant_id: 'test-tenant-id',
      });
      mockPrisma.catalogItem.count.mockResolvedValue(0);
      mockPrisma.vendor.count.mockResolvedValue(2);

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if delete target missing', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue(null);

      await expect(service.remove(1)).rejects.toThrow(NotFoundException);
    });
  });
});
