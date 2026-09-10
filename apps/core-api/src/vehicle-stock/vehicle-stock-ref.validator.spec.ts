import { NotFoundException } from '@nestjs/common';
import {
  assertTenantCustomerExists,
  assertTenantStorageLocationExists,
  assertTenantVendorExists,
} from './vehicle-stock-ref.validator';

describe('vehicle-stock-ref.validator', () => {
  const tenantId = 'tenant-123';

  describe('assertTenantStorageLocationExists', () => {
    it('succeeds when location exists for tenant', async () => {
      const prisma = {
        storageLocation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'loc-1' }),
        },
      };

      await expect(
        assertTenantStorageLocationExists(prisma as any, tenantId, 'loc-1'),
      ).resolves.toBeUndefined();

      expect(prisma.storageLocation.findFirst).toHaveBeenCalledWith({
        where: { id: 'loc-1', tenant_id: tenantId },
        select: { id: true },
      });
    });

    it('throws NotFoundException when location not found for tenant', async () => {
      const prisma = {
        storageLocation: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      await expect(
        assertTenantStorageLocationExists(
          prisma as any,
          tenantId,
          'loc-missing',
        ),
      ).rejects.toThrow(
        new NotFoundException('Location loc-missing not found'),
      );
    });
  });

  describe('assertTenantCustomerExists', () => {
    it('succeeds when customer exists for tenant', async () => {
      const prisma = {
        customer: {
          findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }),
        },
      };

      await expect(
        assertTenantCustomerExists(prisma as any, tenantId, 'cust-1'),
      ).resolves.toBeUndefined();

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1', tenant_id: tenantId },
        select: { id: true },
      });
    });

    it('throws NotFoundException when customer not found for tenant', async () => {
      const prisma = {
        customer: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      await expect(
        assertTenantCustomerExists(prisma as any, tenantId, 'cust-missing'),
      ).rejects.toThrow(
        new NotFoundException('Customer cust-missing not found'),
      );
    });
  });

  describe('assertTenantVendorExists', () => {
    it('succeeds when vendor exists for tenant', async () => {
      const prisma = {
        vendor: {
          findFirst: jest.fn().mockResolvedValue({ id: 'vend-1' }),
        },
      };

      await expect(
        assertTenantVendorExists(prisma as any, tenantId, 'vend-1'),
      ).resolves.toBeUndefined();

      expect(prisma.vendor.findFirst).toHaveBeenCalledWith({
        where: { id: 'vend-1', tenant_id: tenantId },
        select: { id: true },
      });
    });

    it('throws NotFoundException when vendor not found for tenant', async () => {
      const prisma = {
        vendor: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      await expect(
        assertTenantVendorExists(prisma as any, tenantId, 'vend-missing'),
      ).rejects.toThrow(new NotFoundException('Vendor vend-missing not found'));
    });
  });
});
