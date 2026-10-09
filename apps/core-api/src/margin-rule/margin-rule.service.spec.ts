import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MarginRoundingStrategy, Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MarginRuleService } from './margin-rule.service.js';

describe('MarginRuleService', () => {
  let service: MarginRuleService;

  const mockPrisma = {
    marginRule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    brand: {
      findFirst: jest.fn(),
    },
    revenueGroup: {
      findFirst: jest.fn(),
    },
    financeSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const mockTenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      userId: 'user-admin',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarginRuleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TenantContextService, useValue: mockTenantContext },
      ],
    }).compile();

    service = module.get<MarginRuleService>(MarginRuleService);
    jest.clearAllMocks();

    mockTenantContext.getTenantId.mockResolvedValue('tenant-1');
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'user-admin',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
  });

  describe('findAll', () => {
    it('returns tenant-scoped margin rules ordered by priority asc', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          tenant_id: 'tenant-1',
          name: 'High Priority Rule',
          priority: 0,
          brand_id: 10,
          brand: { id: 10, name: 'Bosch' },
          revenue_group_id: null,
          revenue_group: null,
          cost_min: new Prisma.Decimal('10.00'),
          cost_max: new Prisma.Decimal('50.00'),
          markup_percent: new Prisma.Decimal('30.00'),
          use_supplier_rrp: false,
          rounding: MarginRoundingStrategy.ROUND_90,
          is_active: true,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
        {
          id: 'rule-2',
          tenant_id: 'tenant-1',
          name: 'Default Fallback Rule',
          priority: 10,
          brand_id: null,
          brand: null,
          revenue_group_id: 20,
          revenue_group: { id: 20, name: 'Spare Parts' },
          cost_min: null,
          cost_max: null,
          markup_percent: new Prisma.Decimal('25.00'),
          use_supplier_rrp: true,
          rounding: MarginRoundingStrategy.NONE,
          is_active: true,
          createdAt: new Date('2026-01-02'),
          updatedAt: new Date('2026-01-02'),
        },
      ];

      mockPrisma.marginRule.findMany.mockResolvedValue(mockRules);

      const result = await service.findAll();

      expect(mockPrisma.marginRule.findMany).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1' },
        orderBy: { priority: 'asc' },
        include: {
          brand: { select: { id: true, name: true } },
          revenue_group: { select: { id: true, name: true } },
        },
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'rule-1',
        tenant_id: 'tenant-1',
        name: 'High Priority Rule',
        priority: 0,
        brand_id: 10,
        brand: { id: 10, name: 'Bosch' },
        revenue_group_id: null,
        revenue_group: null,
        cost_min: 10,
        cost_max: 50,
        markup_percent: 30,
        use_supplier_rrp: false,
        rounding: MarginRoundingStrategy.ROUND_90,
        is_active: true,
        createdAt: mockRules[0].createdAt,
        updatedAt: mockRules[0].updatedAt,
      });
      expect(result[1].markup_percent).toBe(25);
    });
  });

  describe('create', () => {
    it('creates a margin rule successfully with brand and revenue group', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue({ id: 10, name: 'Bosch' });
      mockPrisma.revenueGroup.findFirst.mockResolvedValue({ id: 20, name: 'Spare Parts' });

      const createdRow = {
        id: 'rule-new',
        tenant_id: 'tenant-1',
        name: 'New Rule',
        priority: 5,
        brand_id: 10,
        brand: { id: 10, name: 'Bosch' },
        revenue_group_id: 20,
        revenue_group: { id: 20, name: 'Spare Parts' },
        cost_min: new Prisma.Decimal('5.00'),
        cost_max: new Prisma.Decimal('100.00'),
        markup_percent: new Prisma.Decimal('40.00'),
        use_supplier_rrp: false,
        rounding: MarginRoundingStrategy.ROUND_99,
        is_active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.marginRule.create.mockResolvedValue(createdRow);

      const result = await service.create({
        name: 'New Rule',
        priority: 5,
        brand_id: 10,
        revenue_group_id: 20,
        cost_min: 5,
        cost_max: 100,
        markup_percent: 40,
        use_supplier_rrp: false,
        rounding: MarginRoundingStrategy.ROUND_99,
        is_active: true,
      });

      expect(mockPrisma.brand.findFirst).toHaveBeenCalledWith({
        where: { id: 10, tenant_id: 'tenant-1' },
        select: { id: true },
      });
      expect(mockPrisma.revenueGroup.findFirst).toHaveBeenCalledWith({
        where: { id: 20, tenant_id: 'tenant-1' },
        select: { id: true },
      });
      expect(mockPrisma.marginRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          name: 'New Rule',
          priority: 5,
          brand_id: 10,
          revenue_group_id: 20,
        }),
        include: {
          brand: { select: { id: true, name: true } },
          revenue_group: { select: { id: true, name: true } },
        },
      });
      expect(result.id).toBe('rule-new');
      expect(result.cost_min).toBe(5);
    });

    it('rejects creation if brand does not exist or belongs to another tenant', async () => {
      mockPrisma.brand.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          name: 'Invalid Brand Rule',
          brand_id: 999,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.marginRule.create).not.toHaveBeenCalled();
    });

    it('rejects creation if revenue group does not exist or belongs to another tenant', async () => {
      mockPrisma.revenueGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          name: 'Invalid Rev Group Rule',
          revenue_group_id: 888,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.marginRule.create).not.toHaveBeenCalled();
    });

    it('rejects creation if cost_min is greater than cost_max', async () => {
      await expect(
        service.create({
          name: 'Invalid Range Rule',
          cost_min: 100,
          cost_max: 50,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException if non-admin (TECH) tries to create', async () => {
      mockTenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'tech-user',
        tenantId: 'tenant-1',
        role: 'TECH',
      });

      await expect(
        service.create({
          name: 'Forbidden Rule',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('updates a margin rule successfully', async () => {
      mockPrisma.marginRule.findFirst.mockResolvedValue({
        id: 'rule-1',
        tenant_id: 'tenant-1',
      });
      mockPrisma.brand.findFirst.mockResolvedValue({ id: 11, name: 'Continental' });

      const updatedRow = {
        id: 'rule-1',
        tenant_id: 'tenant-1',
        name: 'Updated Name',
        priority: 2,
        brand_id: 11,
        brand: { id: 11, name: 'Continental' },
        revenue_group_id: null,
        revenue_group: null,
        cost_min: null,
        cost_max: null,
        markup_percent: new Prisma.Decimal('35.00'),
        use_supplier_rrp: false,
        rounding: MarginRoundingStrategy.NONE,
        is_active: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.marginRule.update.mockResolvedValue(updatedRow);

      const result = await service.update('rule-1', {
        name: 'Updated Name',
        priority: 2,
        brand_id: 11,
        is_active: false,
      });

      expect(mockPrisma.marginRule.findFirst).toHaveBeenCalledWith({
        where: { id: 'rule-1', tenant_id: 'tenant-1' },
      });
      expect(mockPrisma.marginRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: expect.objectContaining({
          name: 'Updated Name',
          priority: 2,
          brand_id: 11,
          is_active: false,
        }),
        include: {
          brand: { select: { id: true, name: true } },
          revenue_group: { select: { id: true, name: true } },
        },
      });
      expect(result.name).toBe('Updated Name');
      expect(result.is_active).toBe(false);
    });

    it('throws NotFoundException if margin rule does not exist or belongs to another tenant', async () => {
      mockPrisma.marginRule.findFirst.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'Something' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if non-admin (TECH) tries to update', async () => {
      mockTenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'tech-user',
        tenantId: 'tenant-1',
        role: 'TECH',
      });

      await expect(
        service.update('rule-1', { name: 'Something' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('deletes a margin rule successfully', async () => {
      mockPrisma.marginRule.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.delete('rule-1');

      expect(mockPrisma.marginRule.deleteMany).toHaveBeenCalledWith({
        where: { id: 'rule-1', tenant_id: 'tenant-1' },
      });
      expect(result).toEqual({ success: true });
    });

    it('throws NotFoundException if rule does not exist or belongs to another tenant', async () => {
      mockPrisma.marginRule.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.delete('missing-rule')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if non-admin (TECH) tries to delete', async () => {
      mockTenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'tech-user',
        tenantId: 'tenant-1',
        role: 'TECH',
      });

      await expect(service.delete('rule-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('threshold', () => {
    it('gets price jump threshold percentage from FinanceSettings (defaults to 20)', async () => {
      mockPrisma.financeSettings.findUnique.mockResolvedValue({
        price_jump_threshold_percent: new Prisma.Decimal('15.50'),
      });

      const result = await service.getThreshold();

      expect(mockPrisma.financeSettings.findUnique).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1' },
        select: { price_jump_threshold_percent: true },
      });
      expect(result.price_jump_threshold_percent).toBe(15.5);
    });

    it('returns default 20 if finance settings or threshold is null', async () => {
      mockPrisma.financeSettings.findUnique.mockResolvedValue(null);

      const result = await service.getThreshold();

      expect(result.price_jump_threshold_percent).toBe(20);
    });

    it('updates price jump threshold percentage on FinanceSettings', async () => {
      mockPrisma.financeSettings.upsert.mockResolvedValue({
        price_jump_threshold_percent: new Prisma.Decimal('25.00'),
      });

      const result = await service.updateThreshold({
        price_jump_threshold_percent: 25,
      });

      expect(mockPrisma.financeSettings.upsert).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1' },
        update: {
          price_jump_threshold_percent: new Prisma.Decimal(25),
        },
        create: expect.objectContaining({
          tenant_id: 'tenant-1',
          price_jump_threshold_percent: new Prisma.Decimal(25),
        }),
      });
      expect(result.price_jump_threshold_percent).toBe(25);
    });

    it('throws ForbiddenException if non-admin (TECH) tries to update threshold', async () => {
      mockTenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'tech-user',
        tenantId: 'tenant-1',
        role: 'TECH',
      });

      await expect(
        service.updateThreshold({ price_jump_threshold_percent: 30 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
