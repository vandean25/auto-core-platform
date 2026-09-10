import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

type StorageLocationLookupClient = Pick<PrismaService, 'storageLocation'>;
type CustomerLookupClient = Pick<PrismaService, 'customer'>;
type VendorLookupClient = Pick<PrismaService, 'vendor'>;

export async function assertTenantStorageLocationExists(
  prisma: StorageLocationLookupClient,
  tenantId: string,
  locationId: string,
): Promise<void> {
  const location = await prisma.storageLocation.findFirst({
    where: { id: locationId, tenant_id: tenantId },
    select: { id: true },
  });
  if (!location) {
    throw new NotFoundException(`Location ${locationId} not found`);
  }
}

export async function assertTenantCustomerExists(
  prisma: CustomerLookupClient,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenant_id: tenantId },
    select: { id: true },
  });
  if (!customer) {
    throw new NotFoundException(`Customer ${customerId} not found`);
  }
}

export async function assertTenantVendorExists(
  prisma: VendorLookupClient,
  tenantId: string,
  vendorId: string,
): Promise<void> {
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, tenant_id: tenantId },
    select: { id: true },
  });
  if (!vendor) {
    throw new NotFoundException(`Vendor ${vendorId} not found`);
  }
}
