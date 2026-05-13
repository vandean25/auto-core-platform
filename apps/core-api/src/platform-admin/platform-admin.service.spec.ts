import { TenantPlan } from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { PlatformAdminService } from './platform-admin.service';

const mockSystemPrisma = {
  tenant: {
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

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
        plan: TenantPlan.STANDARD,
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
          plan: TenantPlan.STANDARD,
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
  });

  it('creates a tenant and its default finance settings in one transaction', async () => {
    const tenantCreate = jest.fn().mockResolvedValue({
      id: 'tenant-2',
      name: 'North Branch',
      slug: 'north-branch',
      plan: TenantPlan.PREMIUM,
      is_active: true,
      created_at: new Date('2026-04-23T12:00:00.000Z'),
      updated_at: new Date('2026-04-23T12:00:00.000Z'),
      _count: { memberships: 0 },
    });
    const financeSettingsCreate = jest.fn().mockResolvedValue(undefined);

    mockSystemPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        tenant: { create: tenantCreate },
        financeSettings: { create: financeSettingsCreate },
      }),
    );

    const result = await service.create({
      name: 'North Branch',
      slug: 'north-branch',
      plan: TenantPlan.PREMIUM,
    });

    expect(tenantCreate).toHaveBeenCalledWith({
      data: {
        name: 'North Branch',
        slug: 'north-branch',
        plan: TenantPlan.PREMIUM,
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
    expect(result).toMatchObject({
      id: 'tenant-2',
      slug: 'north-branch',
      plan: TenantPlan.PREMIUM,
      memberCount: 0,
    });
  });
});