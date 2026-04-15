import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LaborService } from './labor.service';

const mockPrisma = {
  laborOperation: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  laborCategory: {
    findUnique: jest.fn(),
  },
  workshopOrder: {
    findUnique: jest.fn(),
  },
};

const baseOperation = {
  id: 'op-1',
  code: 'OP001',
  description: 'Oil Change',
  standard_aw: 1.5,
  hourly_rate: 100,
  internal_cost: null,
  category_id: null,
  category: null,
  is_active: true,
  fitments: [],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('LaborService', () => {
  let service: LaborService;

  beforeEach(() => {
    service = new LaborService(mockPrisma as unknown as PrismaService);
    jest.clearAllMocks();
  });

  // ── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated operations with default params', async () => {
      mockPrisma.laborOperation.findMany.mockResolvedValue([baseOperation]);
      mockPrisma.laborOperation.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(25);
      expect(result.meta.totalPages).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].code).toBe('OP001');
    });

    it('maps Decimal fields to numbers', async () => {
      mockPrisma.laborOperation.findMany.mockResolvedValue([baseOperation]);
      mockPrisma.laborOperation.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(typeof result.data[0].standardAw).toBe('number');
      expect(typeof result.data[0].hourlyRate).toBe('number');
    });

    it('applies search filter to OR query', async () => {
      mockPrisma.laborOperation.findMany.mockResolvedValue([]);
      mockPrisma.laborOperation.count.mockResolvedValue(0);

      await service.findAll({ search: 'oil' });

      expect(mockPrisma.laborOperation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) }),
        }),
      );
    });

    it('applies categoryId filter', async () => {
      mockPrisma.laborOperation.findMany.mockResolvedValue([]);
      mockPrisma.laborOperation.count.mockResolvedValue(0);

      await service.findAll({ categoryId: 'cat-uuid' });

      expect(mockPrisma.laborOperation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category_id: 'cat-uuid' }),
        }),
      );
    });

    it('applies isActive filter', async () => {
      mockPrisma.laborOperation.findMany.mockResolvedValue([]);
      mockPrisma.laborOperation.count.mockResolvedValue(0);

      await service.findAll({ isActive: false });

      expect(mockPrisma.laborOperation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_active: false }),
        }),
      );
    });

    it('respects page and limit params', async () => {
      mockPrisma.laborOperation.findMany.mockResolvedValue([]);
      mockPrisma.laborOperation.count.mockResolvedValue(50);

      const result = await service.findAll({ page: 2, limit: 10 });

      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.totalPages).toBe(5);
      expect(mockPrisma.laborOperation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns a mapped operation by ID', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(baseOperation);

      const result = await service.findOne('op-1');

      expect(result.id).toBe('op-1');
      expect(result.standardAw).toBe(1.5);
      expect(result.hourlyRate).toBe(100);
      expect(result.isActive).toBe(true);
    });

    it('throws NotFoundException when operation not found', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    const createDto = {
      code: 'OP001',
      description: 'Oil Change',
      standardAw: 1.5,
      hourlyRate: 100,
    };

    it('creates an operation successfully', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(null);
      mockPrisma.laborOperation.create.mockResolvedValue(baseOperation);

      const result = await service.create(createDto);

      expect(result.code).toBe('OP001');
      expect(mockPrisma.laborOperation.create).toHaveBeenCalled();
    });

    it('throws ConflictException on duplicate code (pre-check)', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.laborOperation.create).not.toHaveBeenCalled();
    });

    it('maps Prisma P2002 to ConflictException (concurrent duplicate)', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(null);
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '0',
      });
      mockPrisma.laborOperation.create.mockRejectedValue(p2002);

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
    });

    it('validates categoryId exists and is active', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(null);
      mockPrisma.laborCategory.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ ...createDto, categoryId: 'cat-uuid' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when category is inactive', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(null);
      mockPrisma.laborCategory.findUnique.mockResolvedValue({
        id: 'cat-uuid',
        is_active: false,
      });

      await expect(
        service.create({ ...createDto, categoryId: 'cat-uuid' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates operation with fitments', async () => {
      const opWithFitments = {
        ...baseOperation,
        fitments: [
          {
            id: 'fit-1',
            make: 'Toyota',
            model: 'Corolla',
            year_from: 2010,
            year_to: 2020,
            engine_code: '1ZZ',
          },
        ],
      };
      mockPrisma.laborOperation.findUnique.mockResolvedValue(null);
      mockPrisma.laborOperation.create.mockResolvedValue(opWithFitments);

      const result = await service.create({
        ...createDto,
        fitments: [
          { make: 'Toyota', model: 'Corolla', yearFrom: 2010, yearTo: 2020, engineCode: '1ZZ' },
        ],
      });

      expect(result.fitments).toHaveLength(1);
      expect(result.fitments[0].make).toBe('Toyota');
    });

    it('creates operation with explicit isActive value', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(null);
      mockPrisma.laborOperation.create.mockResolvedValue({
        ...baseOperation,
        is_active: false,
      });

      const result = await service.create({
        ...createDto,
        isActive: false,
      });

      expect(result.isActive).toBe(false);
      expect(mockPrisma.laborOperation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_active: false }),
        }),
      );
    });
  });

  // ── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates operation successfully', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(baseOperation);
      mockPrisma.laborOperation.update.mockResolvedValue({
        ...baseOperation,
        description: 'Updated Description',
      });

      const result = await service.update('op-1', { description: 'Updated Description' });

      expect(result.description).toBe('Updated Description');
    });

    it('throws NotFoundException when operation not found', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { description: 'New' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when new code is already taken', async () => {
      mockPrisma.laborOperation.findUnique
        .mockResolvedValueOnce(baseOperation) // operation exists
        .mockResolvedValueOnce({ id: 'other-op' }); // code taken

      await expect(service.update('op-1', { code: 'TAKEN' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not re-check code uniqueness when code is unchanged', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValueOnce(baseOperation);
      mockPrisma.laborOperation.update.mockResolvedValue({
        ...baseOperation,
        description: 'Updated',
      });

      await service.update('op-1', { code: 'OP001', description: 'Updated' });

      expect(mockPrisma.laborOperation.findUnique).toHaveBeenCalledTimes(1);
    });

    it('replaces fitments when fitments array provided', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(baseOperation);
      mockPrisma.laborOperation.update.mockResolvedValue({
        ...baseOperation,
        fitments: [{ id: 'fit-2', make: 'Honda', model: 'Civic', year_from: null, year_to: null, engine_code: null }],
      });

      const result = await service.update('op-1', {
        fitments: [{ make: 'Honda', model: 'Civic' }],
      });

      expect(result.fitments[0].make).toBe('Honda');
    });

    it('updates is_active when isActive is provided', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(baseOperation);
      mockPrisma.laborOperation.update.mockResolvedValue({
        ...baseOperation,
        is_active: false,
      });

      const result = await service.update('op-1', { isActive: false });

      expect(result.isActive).toBe(false);
      expect(mockPrisma.laborOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_active: false }),
        }),
      );
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('sets is_active to false', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(baseOperation);
      mockPrisma.laborOperation.update.mockResolvedValue({
        ...baseOperation,
        is_active: false,
      });

      const result = await service.softDelete('op-1');

      expect(result.isActive).toBe(false);
      expect(mockPrisma.laborOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'op-1' },
          data: { is_active: false },
        }),
      );
    });

    it('throws NotFoundException when operation not found', async () => {
      mockPrisma.laborOperation.findUnique.mockResolvedValue(null);

      await expect(service.softDelete('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── search (is_active filter) ─────────────────────────────────────────

  describe('search', () => {
    const vehicle = { make: 'Toyota', model: 'Corolla', year: 2015, engine_code: null };

    it('passes is_active: true to the where clause', async () => {
      mockPrisma.workshopOrder.findUnique.mockResolvedValue({ vehicle });
      mockPrisma.laborOperation.findMany.mockResolvedValue([]);
      mockPrisma.laborOperation.count.mockResolvedValue(0);

      await service.search('oil', 'wo-1');

      expect(mockPrisma.laborOperation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_active: true }),
        }),
      );
    });

    it('throws BadRequestException when q is empty', async () => {
      await expect(service.search('', 'wo-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when workshopOrderId is empty', async () => {
      await expect(service.search('oil', '')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when workshop order not found', async () => {
      mockPrisma.workshopOrder.findUnique.mockResolvedValue(null);

      await expect(service.search('oil', 'wo-missing')).rejects.toThrow(NotFoundException);
    });
  });
});
