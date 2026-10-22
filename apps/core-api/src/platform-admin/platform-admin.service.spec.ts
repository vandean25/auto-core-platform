import { ValidationPipe } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  CreatePlatformTenantDto,
  UpdatePlatformTenantDto,
} from './dto/platform-tenant.dto.js';
import { PlatformAdminService } from './platform-admin.service.js';

const mockSystemPrisma = {
  tenant: {
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('Platform tenant DTO validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('rejects plan on CreatePlatformTenantDto', async () => {
    await expect(
      pipe.transform(
        { name: 'North Branch', slug: 'north-branch', plan: 'STANDARD' },
        { type: 'body', metatype: CreatePlatformTenantDto },
      ),
    ).rejects.toThrow();
  });

  it('rejects plan on UpdatePlatformTenantDto', async () => {
    await expect(
      pipe.transform(
        { name: 'North Branch', plan: 'PREMIUM' },
        { type: 'body', metatype: UpdatePlatformTenantDto },
      ),
    ).rejects.toThrow();
  });
});

describe('PlatformAdminService', () => {
  let service: PlatformAdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlatformAdminService(
      mockSystemPrisma as unknown as SystemPrismaService,
    );
  });

  it('lists tenants with membership counts in a paginated response', async () => {
    mockSystemPrisma.tenant.findMany.mockResolvedValue([
      {
        id: 'tenant-1',
        name: 'Default Workshop',
        slug: 'default-workshop',
        is_active: true,
        created_at: new Date('2026-04-23T10:00:00.000Z'),
        updated_at: new Date('2026-04-23T11:00:00.000Z'),
        _count: {
          memberships: 3,
        },
      },
    ]);
    mockSystemPrisma.tenant.count.mockResolvedValue(1);

    const result = await service.findAll({ page: 1, limit: 25 });

    expect(mockSystemPrisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          _count: {
            select: { memberships: true },
          },
        },
      }),
    );
    expect(result).toEqual({
      data: [
        {
          id: 'tenant-1',
          name: 'Default Workshop',
          slug: 'default-workshop',
          isActive: true,
          memberCount: 3,
          createdAt: new Date('2026-04-23T10:00:00.000Z'),
          updatedAt: new Date('2026-04-23T11:00:00.000Z'),
        },
      ],
      meta: {
        total: 1,
        page: 1,
        limit: 25,
        totalPages: 1,
      },
    });
    expect(result.data[0]).not.toHaveProperty('plan');
  });

  it('creates a tenant and its default finance settings in one transaction', async () => {
    const tenantCreate = jest.fn().mockResolvedValue({
      id: 'tenant-2',
      name: 'North Branch',
      slug: 'north-branch',
      is_active: true,
      created_at: new Date('2026-04-23T12:00:00.000Z'),
      updated_at: new Date('2026-04-23T12:00:00.000Z'),
      _count: { memberships: 0 },
    });
    const financeSettingsCreate = jest.fn().mockResolvedValue(undefined);
    const inspectionTemplateUpsert = jest.fn().mockResolvedValue({
      id: 'template-2',
    });
    const inspectionTemplateItemUpsert = jest.fn().mockResolvedValue(undefined);
    const vehicleEquipmentOptionUpsert = jest.fn().mockResolvedValue(undefined);

    mockSystemPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        tenant: { create: tenantCreate },
        financeSettings: { create: financeSettingsCreate },
        inspectionTemplate: { upsert: inspectionTemplateUpsert },
        inspectionTemplateItem: { upsert: inspectionTemplateItemUpsert },
        vehicleEquipmentOption: { upsert: vehicleEquipmentOptionUpsert },
      }),
    );

    const result = await service.create({
      name: 'North Branch',
      slug: 'north-branch',
    });

    expect(tenantCreate).toHaveBeenCalledWith({
      data: {
        name: 'North Branch',
        slug: 'north-branch',
      },
      include: {
        _count: {
          select: { memberships: true },
        },
      },
    });
    expect(financeSettingsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'tenant-2',
        fiscal_year_start_month: 1,
        next_invoice_number: 1001,
        next_sales_order_number: 1001,
        next_workshop_order_number: 1,
      }),
    });
    expect(inspectionTemplateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_code_version: {
            tenant_id: 'tenant-2',
            code: 'PICKERL_57A_PREP',
            version: 1,
          },
        },
      }),
    );
    expect(result).toMatchObject({
      id: 'tenant-2',
      slug: 'north-branch',
      memberCount: 0,
    });
    expect(result).not.toHaveProperty('plan');
  });

  it('updates a tenant without persisting plan metadata', async () => {
    mockSystemPrisma.tenant.update.mockResolvedValue({
      id: 'tenant-2',
      name: 'North Branch Updated',
      slug: 'north-branch',
      is_active: false,
      created_at: new Date('2026-04-23T12:00:00.000Z'),
      updated_at: new Date('2026-04-23T13:00:00.000Z'),
      _count: { memberships: 2 },
    });

    const result = await service.update('tenant-2', {
      name: 'North Branch Updated',
      isActive: false,
    });

    expect(mockSystemPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-2' },
      data: {
        name: 'North Branch Updated',
        is_active: false,
      },
      include: {
        _count: {
          select: { memberships: true },
        },
      },
    });
    expect(result).toMatchObject({
      name: 'North Branch Updated',
      isActive: false,
      memberCount: 2,
    });
    expect(result).not.toHaveProperty('plan');
  });
});
