import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LaborCategoryService } from './labor-category.service';

const mockPrisma = {
  laborCategory: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  laborOperation: {
    count: jest.fn(),
  },
};

describe('LaborCategoryService', () => {
  let service: LaborCategoryService;

  beforeEach(() => {
    service = new LaborCategoryService(mockPrisma as unknown as PrismaService);
    jest.clearAllMocks();
  });

  // ── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns tree-structured categories with children nested and meta counts', async () => {
      const childData = {
        id: 'child-1',
        name: 'Sub Engine',
        description: null,
        sort_order: 0,
        parent_id: 'parent-1',
        default_hourly_rate: null,
        is_active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const parentData = {
        id: 'parent-1',
        name: 'Engine',
        description: 'Engine work',
        sort_order: 1,
        parent_id: null,
        default_hourly_rate: null,
        is_active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        children: [childData],
      };

      mockPrisma.laborCategory.findMany.mockResolvedValue([parentData]);

      const result = await service.findAll();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('parent-1');
      expect(result.data[0].children).toHaveLength(1);
      expect(result.data[0].children[0].id).toBe('child-1');
      expect(result.meta).toEqual({
        total: 2,
        topLevelCount: 1,
        childCount: 1,
      });
      expect(mockPrisma.laborCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { parent_id: null } }),
      );
    });

    it('converts Decimal default_hourly_rate to Number', async () => {
      mockPrisma.laborCategory.findMany.mockResolvedValue([
        {
          id: 'c1',
          name: 'Brakes',
          description: null,
          sort_order: 0,
          parent_id: null,
          default_hourly_rate: 95.5,
          is_active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          children: [],
        },
      ]);

      const result = await service.findAll();

      expect(typeof result.data[0].default_hourly_rate).toBe('number');
      expect(result.data[0].default_hourly_rate).toBe(95.5);
    });

    it('preserves 0 as a valid default_hourly_rate (not converted to null)', async () => {
      mockPrisma.laborCategory.findMany.mockResolvedValue([
        {
          id: 'c2',
          name: 'Free Service',
          description: null,
          sort_order: 0,
          parent_id: null,
          default_hourly_rate: 0,
          is_active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          children: [],
        },
      ]);

      const result = await service.findAll();

      expect(result.data[0].default_hourly_rate).toBe(0);
    });

    it('returns empty data array and zero meta when no categories exist', async () => {
      mockPrisma.laborCategory.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({
        total: 0,
        topLevelCount: 0,
        childCount: 0,
      });
    });
  });

  // ── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a top-level category successfully', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue(null);
      const mockCreated = {
        id: 'new-1',
        name: 'Engine',
        description: null,
        sort_order: 0,
        parent_id: null,
        default_hourly_rate: null,
        is_active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.laborCategory.create.mockResolvedValue(mockCreated);

      const result = await service.create({ name: 'Engine' });

      expect(result.id).toBe('new-1');
      expect(result.name).toBe('Engine');
    });

    it('preserves 0 as a valid default_hourly_rate on create', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue(null);
      mockPrisma.laborCategory.create.mockResolvedValue({
        id: 'new-2',
        name: 'Free Service',
        description: null,
        sort_order: 0,
        parent_id: null,
        default_hourly_rate: 0,
        is_active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create({
        name: 'Free Service',
        default_hourly_rate: 0,
      });

      expect(result.default_hourly_rate).toBe(0);
    });

    it('throws ConflictException on duplicate name (pre-check)', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create({ name: 'Engine' })).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.laborCategory.create).not.toHaveBeenCalled();
    });

    it('bubbles up Prisma P2002 on create (concurrent duplicate)', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue(null);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint',
        {
          code: 'P2002',
          clientVersion: '0',
        },
      );
      mockPrisma.laborCategory.create.mockRejectedValue(p2002);

      await expect(service.create({ name: 'Engine' })).rejects.toThrow(
        Prisma.PrismaClientKnownRequestError,
      );
    });

    it('creates a subcategory with a valid top-level parent', async () => {
      mockPrisma.laborCategory.findUnique
        .mockResolvedValueOnce(null) // name uniqueness check
        .mockResolvedValueOnce({ id: 'parent-1', parent_id: null }); // parent lookup

      const mockCreated = {
        id: 'sub-1',
        name: 'Oil Change',
        description: null,
        sort_order: 0,
        parent_id: 'parent-1',
        default_hourly_rate: null,
        is_active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.laborCategory.create.mockResolvedValue(mockCreated);

      const result = await service.create({
        name: 'Oil Change',
        parent_id: 'parent-1',
      });

      expect(result.parent_id).toBe('parent-1');
    });

    it('throws NotFoundException when parent_id does not exist', async () => {
      mockPrisma.laborCategory.findUnique
        .mockResolvedValueOnce(null) // name uniqueness check
        .mockResolvedValueOnce(null); // parent not found

      await expect(
        service.create({
          name: 'Oil Change',
          parent_id: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when parent is itself a subcategory (depth > 2)', async () => {
      mockPrisma.laborCategory.findUnique
        .mockResolvedValueOnce(null) // name uniqueness check
        .mockResolvedValueOnce({ id: 'sub-1', parent_id: 'grandparent-1' }); // parent is already a child

      await expect(
        service.create({ name: 'Deep', parent_id: 'sub-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    const existingCategory = {
      id: 'cat-1',
      name: 'Engine',
      description: null,
      sort_order: 0,
      parent_id: null,
      default_hourly_rate: null,
      is_active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('updates a category name successfully', async () => {
      mockPrisma.laborCategory.findUnique
        .mockResolvedValueOnce(existingCategory) // category exists
        .mockResolvedValueOnce(null); // new name is unique
      mockPrisma.laborCategory.update.mockResolvedValue({
        ...existingCategory,
        name: 'Engine Updated',
      });

      const result = await service.update('cat-1', { name: 'Engine Updated' });

      expect(result.name).toBe('Engine Updated');
    });

    it('preserves 0 as a valid default_hourly_rate on update', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValueOnce(
        existingCategory,
      );
      mockPrisma.laborCategory.update.mockResolvedValue({
        ...existingCategory,
        default_hourly_rate: 0,
      });

      const result = await service.update('cat-1', { default_hourly_rate: 0 });

      expect(result.default_hourly_rate).toBe(0);
    });

    it('throws NotFoundException when category does not exist', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'New' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when new name already taken', async () => {
      mockPrisma.laborCategory.findUnique
        .mockResolvedValueOnce(existingCategory) // category exists
        .mockResolvedValueOnce({ id: 'other-cat' }); // name taken

      await expect(
        service.update('cat-1', { name: 'Taken Name' }),
      ).rejects.toThrow(ConflictException);
    });

    it('bubbles up Prisma P2002 on update (concurrent duplicate)', async () => {
      mockPrisma.laborCategory.findUnique
        .mockResolvedValueOnce(existingCategory)
        .mockResolvedValueOnce(null); // name appears unique
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint',
        {
          code: 'P2002',
          clientVersion: '0',
        },
      );
      mockPrisma.laborCategory.update.mockRejectedValue(p2002);

      await expect(
        service.update('cat-1', { name: 'Race Condition' }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });

    it('throws BadRequestException when setting parent_id to self', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValueOnce(
        existingCategory,
      );

      await expect(
        service.update('cat-1', { parent_id: 'cat-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when new parent_id does not exist', async () => {
      mockPrisma.laborCategory.findUnique
        .mockResolvedValueOnce(existingCategory) // category exists
        .mockResolvedValueOnce(null); // parent not found

      await expect(
        service.update('cat-1', {
          parent_id: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when new parent is a subcategory (depth > 2)', async () => {
      mockPrisma.laborCategory.findUnique
        .mockResolvedValueOnce(existingCategory) // category exists
        .mockResolvedValueOnce({ id: 'sub', parent_id: 'grandparent' }); // parent is itself a child

      await expect(
        service.update('cat-1', { parent_id: 'sub' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when re-parenting a category that already has children (depth-3 guard)', async () => {
      mockPrisma.laborCategory.findUnique
        .mockResolvedValueOnce(existingCategory) // category exists
        .mockResolvedValueOnce({ id: 'other-top', parent_id: null }); // valid top-level parent
      // category has 2 children
      mockPrisma.laborCategory.count.mockResolvedValue(2);

      await expect(
        service.update('cat-1', { parent_id: 'other-top' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not re-check name uniqueness when name is unchanged', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValueOnce(
        existingCategory,
      );
      mockPrisma.laborCategory.update.mockResolvedValue({
        ...existingCategory,
        sort_order: 5,
      });

      await service.update('cat-1', { name: 'Engine', sort_order: 5 });

      // findUnique should only be called once (for the category existence check)
      expect(mockPrisma.laborCategory.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  // ── remove ────────────────────────────────────────────────────────────

  describe('remove', () => {
    const existingCategory = {
      id: 'cat-1',
      name: 'Engine',
      description: null,
      sort_order: 0,
      parent_id: null,
      default_hourly_rate: null,
      is_active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('deletes a category with no children and no operations', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue(existingCategory);
      mockPrisma.laborCategory.count.mockResolvedValue(0);
      mockPrisma.laborOperation.count.mockResolvedValue(0);
      mockPrisma.laborCategory.delete.mockResolvedValue(existingCategory);

      const result = await service.remove('cat-1');

      expect(result.id).toBe('cat-1');
      expect(mockPrisma.laborCategory.delete).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
      });
    });

    it('preserves 0 as a valid default_hourly_rate on delete result', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue(existingCategory);
      mockPrisma.laborCategory.count.mockResolvedValue(0);
      mockPrisma.laborOperation.count.mockResolvedValue(0);
      mockPrisma.laborCategory.delete.mockResolvedValue({
        ...existingCategory,
        default_hourly_rate: 0,
      });

      const result = await service.remove('cat-1');

      expect(result.default_hourly_rate).toBe(0);
    });

    it('throws NotFoundException when category does not exist', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when child categories exist', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue(existingCategory);
      mockPrisma.laborCategory.count.mockResolvedValue(2); // has children

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
      expect(mockPrisma.laborCategory.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException when labor operations reference the category', async () => {
      mockPrisma.laborCategory.findUnique.mockResolvedValue(existingCategory);
      mockPrisma.laborCategory.count.mockResolvedValue(0); // no children
      mockPrisma.laborOperation.count.mockResolvedValue(3); // has operations

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
      expect(mockPrisma.laborCategory.delete).not.toHaveBeenCalled();
    });
  });
});
