import { BadRequestException } from '@nestjs/common';
import {
  assertCatalogItemsBelongToTenant,
  assertCustomerBelongsToTenant,
  assertVehicleBelongsToTenant,
  type TenantScopedPrisma,
} from './sales-tenant-validation.helpers.js';
import { fakePrisma } from './prisma-fake.spec.support.js';

describe('sales-tenant-validation.helpers', () => {
  const prisma = {
    customer: { findFirst: jest.fn() },
    vehicle: { findFirst: jest.fn() },
    catalogItem: { count: jest.fn() },
  };
  const scoped = fakePrisma<TenantScopedPrisma>(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes when customer belongs to tenant', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });

    await expect(
      assertCustomerBelongsToTenant(scoped,'customer-1', 'tenant-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects unknown customers', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(
      assertCustomerBelongsToTenant(scoped,'customer-1', 'tenant-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes when vehicle belongs to tenant', async () => {
    prisma.vehicle.findFirst.mockResolvedValue({ id: 'vehicle-1' });

    await expect(
      assertVehicleBelongsToTenant(scoped,'vehicle-1', 'tenant-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects unknown vehicles', async () => {
    prisma.vehicle.findFirst.mockResolvedValue(null);

    await expect(
      assertVehicleBelongsToTenant(scoped,'vehicle-1', 'tenant-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes when all catalog items belong to tenant', async () => {
    prisma.catalogItem.count.mockResolvedValue(2);

    await expect(
      assertCatalogItemsBelongToTenant(
        scoped,
        ['item-1', 'item-2', 'item-1'],
        'tenant-1',
      ),
    ).resolves.toBeUndefined();

    expect(prisma.catalogItem.count).toHaveBeenCalledWith({
      where: { id: { in: ['item-1', 'item-2'] }, tenant_id: 'tenant-1' },
    });
  });

  it('skips catalog validation when no ids are provided', async () => {
    await expect(
      assertCatalogItemsBelongToTenant(scoped,[], 'tenant-1'),
    ).resolves.toBeUndefined();

    expect(prisma.catalogItem.count).not.toHaveBeenCalled();
  });

  it('rejects catalog items from another tenant', async () => {
    prisma.catalogItem.count.mockResolvedValue(1);

    await expect(
      assertCatalogItemsBelongToTenant(scoped,['item-1', 'item-2'], 'tenant-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
