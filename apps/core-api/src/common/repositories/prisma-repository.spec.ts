import { Prisma } from '@prisma/client';
import { PrismaRepository } from './prisma-repository';
import {
  ConflictError,
  NotFoundError,
  BadRequestError,
} from '../errors/application-errors';

describe('PrismaRepository', () => {
  let repository: PrismaRepository<any>;
  let mockModel: any;

  beforeEach(() => {
    mockModel = {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    };
    repository = new PrismaRepository(mockModel);
  });

  // ── findMany (non-paginated) ──────────────────────────────────────────

  describe('findMany', () => {
    it('returns all records with default params', async () => {
      const mockRecords = [{ id: 1 }, { id: 2 }];
      mockModel.findMany.mockResolvedValue(mockRecords);

      const result = await repository.findMany();

      expect(result).toEqual(mockRecords);
      expect(mockModel.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: undefined,
        include: undefined,
        select: undefined,
      });
    });

    it('forwards where and orderBy params', async () => {
      mockModel.findMany.mockResolvedValue([]);

      await repository.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });

      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
          orderBy: { name: 'asc' },
        }),
      );
    });
  });

  // ── findManyPaginated ─────────────────────────────────────────────────

  describe('findManyPaginated', () => {
    it('returns data and meta with default pagination', async () => {
      const mockRecords = [{ id: 1 }, { id: 2 }];
      mockModel.findMany.mockResolvedValue(mockRecords);
      mockModel.count.mockResolvedValue(2);

      const result = await repository.findManyPaginated();

      expect(result).toEqual({
        data: mockRecords,
        meta: {
          total: 2,
          page: 1,
          limit: 25,
          totalPages: 1,
        },
      });
      expect(mockModel.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: undefined,
        skip: 0,
        take: 25,
        include: undefined,
        select: undefined,
      });
    });

    it('applies custom pagination', async () => {
      mockModel.findMany.mockResolvedValue([]);
      mockModel.count.mockResolvedValue(100);

      const result = await repository.findManyPaginated({ page: 2, limit: 10 });

      expect(result.meta).toEqual({
        total: 100,
        page: 2,
        limit: 10,
        totalPages: 10,
      });
      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });

    it('clamps limit to max 100', async () => {
      mockModel.findMany.mockResolvedValue([]);
      mockModel.count.mockResolvedValue(500);

      const result = await repository.findManyPaginated({
        page: 1,
        limit: 999,
      });

      expect(result.meta.limit).toBe(100);
      expect(mockModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });

    it('throws BadRequestError for page < 1', async () => {
      await expect(repository.findManyPaginated({ page: 0 })).rejects.toThrow(
        BadRequestError,
      );
      await expect(repository.findManyPaginated({ page: -5 })).rejects.toThrow(
        BadRequestError,
      );
    });

    it('throws BadRequestError for limit < 1', async () => {
      await expect(repository.findManyPaginated({ limit: 0 })).rejects.toThrow(
        BadRequestError,
      );
      await expect(repository.findManyPaginated({ limit: -1 })).rejects.toThrow(
        BadRequestError,
      );
    });
  });

  // ── findById ──────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns record if found', async () => {
      const mockRecord = { id: 1 };
      mockModel.findUnique.mockResolvedValue(mockRecord);

      const result = await repository.findById(1);

      expect(result).toEqual(mockRecord);
    });

    it('throws NotFoundError if record missing', async () => {
      mockModel.findUnique.mockResolvedValue(null);

      await expect(repository.findById(999)).rejects.toThrow(NotFoundError);
    });

    it('passes include option through', async () => {
      mockModel.findUnique.mockResolvedValue({ id: 1 });

      await repository.findById(1, { items: true });

      expect(mockModel.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { items: true },
      });
    });
  });

  // ── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates record successfully', async () => {
      const data = { name: 'Test' };
      mockModel.create.mockResolvedValue({ id: 1, ...data });

      const result = await repository.create(data);

      expect(result).toEqual({ id: 1, ...data });
    });

    it('throws ConflictError on P2002 with constraint target', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['name'] },
      });
      mockModel.create.mockRejectedValue(error);

      await expect(repository.create({})).rejects.toThrow(ConflictError);
      await expect(repository.create({})).rejects.toThrow(/name/);
    });

    it('throws ConflictError on P2003 foreign key violation', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('FK failed', {
        code: 'P2003',
        clientVersion: 'test',
        meta: { field_name: 'brand_id' },
      });
      mockModel.create.mockRejectedValue(error);

      await expect(repository.create({})).rejects.toThrow(ConflictError);
      await expect(repository.create({})).rejects.toThrow(/brand_id/);
    });
  });

  // ── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates record successfully', async () => {
      const data = { name: 'Updated' };
      mockModel.update.mockResolvedValue({ id: 1, ...data });

      const result = await repository.update(1, data);

      expect(result).toEqual({ id: 1, ...data });
    });

    it('throws NotFoundError on P2025', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('Not Found', {
        code: 'P2025',
        clientVersion: 'test',
      });
      mockModel.update.mockRejectedValue(error);

      await expect(repository.update(1, {})).rejects.toThrow(NotFoundError);
    });
  });

  // ── delete ────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes record successfully', async () => {
      mockModel.delete.mockResolvedValue({ id: 1 });

      const result = await repository.delete(1);

      expect(result).toEqual({ id: 1 });
    });

    it('throws NotFoundError on P2025', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('Not Found', {
        code: 'P2025',
        clientVersion: 'test',
      });
      mockModel.delete.mockRejectedValue(error);

      await expect(repository.delete(1)).rejects.toThrow(NotFoundError);
    });
  });

  // ── Error mapping (via create as proxy) ───────────────────────────────

  describe('mapPrismaError', () => {
    it('throws sanitized BadRequestError on PrismaClientValidationError', async () => {
      const error = new Prisma.PrismaClientValidationError(
        'Model `Brand` field `name` expects type String, got Int',
        { clientVersion: 'test' },
      );
      mockModel.create.mockRejectedValue(error);

      const thrown = await repository.create({}).catch((e) => e);

      expect(thrown).toBeInstanceOf(BadRequestError);
      // Verify the raw Prisma schema details are NOT in the message
      expect(thrown.message).not.toContain('Model');
      expect(thrown.message).not.toContain('Brand');
      expect(thrown.message).toContain('Invalid data provided');
    });

    it('rethrows unknown errors as-is', async () => {
      const error = new Error('Connection timeout');
      mockModel.create.mockRejectedValue(error);

      await expect(repository.create({})).rejects.toThrow('Connection timeout');
    });

    it('wraps non-Error throwables in Error', async () => {
      mockModel.create.mockRejectedValue('raw string error');

      await expect(repository.create({})).rejects.toThrow(Error);
    });
  });
});
